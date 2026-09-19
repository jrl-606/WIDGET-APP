import { currentUser } from '@/lib/currentUser';
import { sql } from '@/lib/db';
import { badRequest, handler, json, notFound, pageLimit, readJson, requireString } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ otherId: string }> };

type MessageRow = {
  id: string | number;
  sender_id: string;
  body: string;
  sent_at: string;
};

/** `dm_messages` stores one canonical row per pair, with user_a < user_b. */
const pair = (a: string, b: string) => (a < b ? ([a, b] as const) : ([b, a] as const));

async function requireCounterpart(otherId: string): Promise<string> {
  const rows = (await sql`select id from users where id = ${otherId}`) as { id: string }[];
  if (rows.length === 0) throw notFound('No such Widget ID');
  return rows[0].id;
}

const serialize = (row: MessageRow, me: string) => ({
  id: String(row.id),
  senderId: row.sender_id,
  body: row.body,
  sentAt: new Date(row.sent_at).toISOString(),
  mine: row.sender_id === me,
});

/**
 * GET /api/dm/:otherId
 * Message history between the verified caller and `:otherId`, oldest first.
 */
export const GET = handler<Ctx>(async (req, { params }) => {
  const { otherId } = await params;
  const me = await currentUser(req);
  if (otherId === me.id) throw badRequest('You cannot DM yourself');
  await requireCounterpart(otherId);

  const [userA, userB] = pair(me.id, otherId);
  const limit = pageLimit(req);

  const rows = (await sql`
    select id, sender_id, body, sent_at from dm_messages
    where user_a = ${userA} and user_b = ${userB}
    order by sent_at desc, id desc
    limit ${limit}
  `) as MessageRow[];

  return json({
    withUserId: otherId,
    messages: rows.reverse().map((row) => serialize(row, me.id)),
  });
});

/**
 * POST /api/dm/:otherId
 * Sends a DM as the verified caller — the sender is never read from the body.
 */
export const POST = handler<Ctx>(async (req, { params }) => {
  const { otherId } = await params;
  const me = await currentUser(req);
  if (otherId === me.id) throw badRequest('You cannot DM yourself');
  await requireCounterpart(otherId);

  const body = await readJson(req);
  const text = requireString(body, 'body', { max: 4000 });
  const [userA, userB] = pair(me.id, otherId);

  const rows = (await sql`
    insert into dm_messages (user_a, user_b, sender_id, body)
    values (${userA}, ${userB}, ${me.id}, ${text})
    returning id, sender_id, body, sent_at
  `) as MessageRow[];

  return json({ message: serialize(rows[0], me.id) }, 201);
});
