import { currentUser } from '@/lib/currentUser';
import { sql } from '@/lib/db';
import { requireOwner } from '@/lib/groups';
import { badRequest, conflict, handler, json, notFound, readJson, requireString } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ groupId: string }> };

/**
 * POST /api/groups/:groupId/invite
 * Invites a Widget ID to the group. 403s unless the caller owns the group.
 */
export const POST = handler<Ctx>(async (req, { params }) => {
  const { groupId } = await params;
  const me = await currentUser(req);
  await requireOwner(groupId, me.id);

  const body = await readJson(req);
  const inviteeId = requireString(body, 'userId', { max: 64 });
  if (inviteeId === me.id) throw badRequest('You are already in your own group');

  const invitee = (await sql`select id from users where id = ${inviteeId}`) as { id: string }[];
  if (invitee.length === 0) throw notFound('No such Widget ID');

  const existing = (await sql`
    select status from group_members where group_id = ${groupId} and user_id = ${inviteeId}
  `) as { status: string }[];
  if (existing.length > 0) {
    throw conflict(
      existing[0].status === 'member'
        ? 'That user is already a member'
        : 'That user already has a pending invite',
    );
  }

  await sql`
    insert into group_members (group_id, user_id, status)
    values (${groupId}, ${inviteeId}, 'pending')
    on conflict (group_id, user_id) do nothing
  `;

  return json({ groupId, userId: inviteeId, status: 'pending' }, 201);
});
