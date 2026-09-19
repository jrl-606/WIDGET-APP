import { currentUser } from '@/lib/currentUser';
import { sql } from '@/lib/db';
import { loadGroup } from '@/lib/groups';
import { badRequest, conflict, handler, json, notFound, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ groupId: string }> };

/**
 * POST /api/groups/:groupId/respond
 * Accepts or declines the caller's OWN pending invite. Identity comes from the
 * session, so nobody can answer an invite on someone else's behalf. Declining
 * removes the row — there is no stored "declined" state.
 */
export const POST = handler<Ctx>(async (req, { params }) => {
  const { groupId } = await params;
  const me = await currentUser(req);
  await loadGroup(groupId);

  const body = await readJson(req);
  const action = body.action;
  if (action !== 'accept' && action !== 'decline') {
    throw badRequest('"action" must be "accept" or "decline"');
  }

  const existing = (await sql`
    select status from group_members where group_id = ${groupId} and user_id = ${me.id}
  `) as { status: string }[];
  if (existing.length === 0) throw notFound('You have no invite to this group');
  if (existing[0].status === 'member') throw conflict('You are already a member of this group');

  if (action === 'accept') {
    await sql`
      update group_members set status = 'member', joined_at = now()
      where group_id = ${groupId} and user_id = ${me.id} and status = 'pending'
    `;
    return json({ groupId, userId: me.id, status: 'member' });
  }

  await sql`
    delete from group_members
    where group_id = ${groupId} and user_id = ${me.id} and status = 'pending'
  `;
  return json({ groupId, userId: me.id, status: 'declined' });
});
