import { currentUser } from '@/lib/currentUser';
import { sql } from '@/lib/db';
import { handler, json, readJson, requireString } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/users
 * Updates your own display name. There is no POST: Widget IDs are minted by
 * /api/auth/me against a verified account, never claimed from a request body.
 */
export const PATCH = handler(async (req: Request) => {
  const me = await currentUser(req);
  const body = await readJson(req);
  const displayName = requireString(body, 'displayName', { max: 80 });

  const rows = (await sql`
    update users set display_name = ${displayName} where id = ${me.id}
    returning id, display_name
  `) as { id: string; display_name: string }[];

  return json({ userId: rows[0].id, displayName: rows[0].display_name });
});
