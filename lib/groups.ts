import { sql } from './db';
import { forbidden, notFound } from './http';

export const MAX_OWNED_GROUPS = 5;

export type GroupRow = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
};

export type MembershipStatus = 'pending' | 'member';

export async function loadGroup(groupId: string): Promise<GroupRow> {
  const rows = (await sql`
    select id, name, owner_id, created_at from groups where id = ${groupId}
  `) as GroupRow[];
  if (rows.length === 0) throw notFound('Group not found');
  return rows[0];
}

export async function membershipStatus(
  groupId: string,
  userId: string,
): Promise<MembershipStatus | null> {
  const rows = (await sql`
    select status from group_members where group_id = ${groupId} and user_id = ${userId}
  `) as { status: MembershipStatus }[];
  return rows[0]?.status ?? null;
}

/**
 * A group's owner is always a member; everyone else has to have accepted.
 * Used by the members and messages routes to 403 non-members.
 */
export async function requireActiveMember(groupId: string, userId: string): Promise<GroupRow> {
  const group = await loadGroup(groupId);
  if (group.owner_id === userId) return group;
  const status = await membershipStatus(groupId, userId);
  if (status !== 'member') throw forbidden('You are not a member of this group');
  return group;
}

export async function requireOwner(groupId: string, userId: string): Promise<GroupRow> {
  const group = await loadGroup(groupId);
  if (group.owner_id !== userId) throw forbidden('Only the group owner can do that');
  return group;
}

export function newGroupId(): string {
  return `g_${crypto.randomUUID()}`;
}

export function serializeGroup(group: GroupRow, role: 'owner' | 'member' | 'invited') {
  return {
    id: group.id,
    name: group.name,
    ownerId: group.owner_id,
    createdAt: new Date(group.created_at).toISOString(),
    role,
  };
}
