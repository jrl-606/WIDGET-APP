import { currentUser } from '@/lib/currentUser';
import { sql } from '@/lib/db';
import { requireActiveMember } from '@/lib/groups';
import { handler, json, pageLimit, readJson, requireString } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ groupId: string }> };

type MessageRow = {
  id: string | number;
  sender_id: string;
  display_name: string;
  body: string;
  sent_at: string;
};

const serialize = (row: MessageRow, me: string) => ({
  id: String(row.id),
  senderId: row.sender_id,
  senderName: row.display_name,
  body: row.body,
  sentAt: new Date(row.sent_at).toISOString(),
  mine: row.sender_id === me,
});

/**
 * GET /api/groups/:groupId/messages
 * Group chat history, oldest first. 403s unless the caller is a member, which
 * is what keeps each group's chat isolated from every other group.
 */
export const GET = handler<Ctx>(async (req, { params }) => {
  const { groupId } = await params;
  const me = await currentUser(req);
  await requireActiveMember(groupId, me.id);
  const limit = pageLimit(req);

  const rows = (await sql`
    select m.id, m.sender_id, u.display_name, m.body, m.sent_at
    from group_messages m
    join users u on u.id = m.sender_id
    where m.group_id = ${groupId}
    order by m.sent_at desc, m.id desc
    limit ${limit}
  `) as MessageRow[];

  return json({ groupId, messages: rows.reverse().map((row) => serialize(row, me.id)) });
});

/** POST /api/groups/:groupId/messages — post as yourself; members only. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const { groupId } = await params;
  const me = await currentUser(req);
  await requireActiveMember(groupId, me.id);

  const body = await readJson(req);
  const text = requireString(body, 'body', { max: 4000 });

  const rows = (await sql`
    insert into group_messages (group_id, sender_id, body)
    values (${groupId}, ${me.id}, ${text})
    returning id, sender_id, body, sent_at
  `) as Omit<MessageRow, 'display_name'>[];

  return json(
    { message: serialize({ ...rows[0], display_name: me.displayName }, me.id) },
    201,
  );
});
