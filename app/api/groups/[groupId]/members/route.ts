import { currentUser } from '@/lib/currentUser';
import { sql } from '@/lib/db';
import { requireActiveMember } from '@/lib/groups';
import { handler, json } from '@/lib/http';
import { rankFor, standingsFrom } from '@/lib/ranks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ groupId: string }> };

type MemberRow = {
  user_id: string;
  display_name: string;
  status: 'pending' | 'member';
  joined_at: string | null;
  category: string | null;
  points: string | number | null;
};

/**
 * GET /api/groups/:groupId/members
 * Member names plus their public rank per life area. 403s unless the caller is
 * a member — pending invitees can't read the roster.
 */
export const GET = handler<Ctx>(async (req, { params }) => {
  const { groupId } = await params;
  const me = await currentUser(req);
  const group = await requireActiveMember(groupId, me.id);

  // One pass: every membership row, left-joined to that member's scored goals
  // grouped by category.
  const rows = (await sql`
    select gm.user_id, u.display_name, gm.status, gm.joined_at,
           points.category, points.points
    from group_members gm
    join users u on u.id = gm.user_id
    left join lateral (
      select category, coalesce(sum(score), 0) as points
      from goals where goals.user_id = gm.user_id
      group by category
    ) points on true
    where gm.group_id = ${groupId}
    order by u.display_name, gm.user_id
  `) as MemberRow[];

  const byUser = new Map<
    string,
    { displayName: string; status: string; joinedAt: string | null; points: Map<string, number> }
  >();

  for (const row of rows) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      entry = {
        displayName: row.display_name,
        status: row.status,
        joinedAt: row.joined_at ? new Date(row.joined_at).toISOString() : null,
        points: new Map(),
      };
      byUser.set(row.user_id, entry);
    }
    if (row.category) entry.points.set(row.category, Number(row.points ?? 0));
  }

  const members = [...byUser.entries()].map(([userId, entry]) => {
    const areas = standingsFrom(entry.points);
    const totalPoints = areas.reduce((sum, area) => sum + area.points, 0);
    return {
      userId,
      displayName: entry.displayName,
      status: entry.status,
      joinedAt: entry.joinedAt,
      isOwner: userId === group.owner_id,
      totalPoints,
      overallRank: rankFor(totalPoints),
      areas,
    };
  });

  return json({
    groupId: group.id,
    name: group.name,
    ownerId: group.owner_id,
    members,
  });
});
