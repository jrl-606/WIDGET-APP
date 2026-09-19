import { currentUser } from '@/lib/currentUser';
import { sql } from '@/lib/db';
import { MAX_OWNED_GROUPS, newGroupId, type GroupRow } from '@/lib/groups';
import { conflict, handler, json, readJson, requireString } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ListRow = GroupRow & { role: 'owner' | 'member' | 'invited' };

/**
 * GET /api/groups
 * Groups the caller owns, belongs to, or has a pending invite to.
 */
export const GET = handler(async (req: Request) => {
  const me = await currentUser(req);

  const rows = (await sql`
    select g.id, g.name, g.owner_id, g.created_at,
      case
        when g.owner_id = ${me.id} then 'owner'
        when gm.status = 'member' then 'member'
        else 'invited'
      end as role
    from groups g
    left join group_members gm on gm.group_id = g.id and gm.user_id = ${me.id}
    where g.owner_id = ${me.id} or gm.user_id = ${me.id}
    order by g.created_at desc
  `) as ListRow[];

  return json({
    groups: rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      createdAt: new Date(row.created_at).toISOString(),
      role: row.role,
    })),
    ownedCount: rows.filter((row) => row.role === 'owner').length,
    maxOwned: MAX_OWNED_GROUPS,
  });
});

/**
 * POST /api/groups
 * Creates a group owned by the verified caller, capped at five owned groups.
 */
export const POST = handler(async (req: Request) => {
  const me = await currentUser(req);
  const body = await readJson(req);
  const name = requireString(body, 'name', { max: 80 });

  const owned = (await sql`
    select count(*) as count from groups where owner_id = ${me.id}
  `) as { count: string | number }[];
  if (Number(owned[0].count) >= MAX_OWNED_GROUPS) {
    throw conflict(`You already own the maximum of ${MAX_OWNED_GROUPS} groups`);
  }

  const rows = (await sql`
    insert into groups (id, name, owner_id)
    values (${newGroupId()}, ${name}, ${me.id})
    returning id, name, owner_id, created_at
  `) as GroupRow[];

  // The owner is a member from the start, so group chat and member listings
  // treat them like everyone else.
  await sql`
    insert into group_members (group_id, user_id, status, joined_at)
    values (${rows[0].id}, ${me.id}, 'member', now())
    on conflict (group_id, user_id) do nothing
  `;

  return json(
    {
      group: {
        id: rows[0].id,
        name: rows[0].name,
        ownerId: rows[0].owner_id,
        createdAt: new Date(rows[0].created_at).toISOString(),
        role: 'owner' as const,
      },
    },
    201,
  );
});
