import { sql } from '@/lib/db';
import { handler, json, notFound } from '@/lib/http';
import { publicStats } from '@/lib/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/users/:id/rank
 * PUBLIC — no auth. Rank and points per life area only; goal counts are
 * private and live on /api/users/:id/private-stats.
 */
export const GET = handler<Ctx>(async (_req, { params }) => {
  const { id } = await params;

  const rows = (await sql`
    select id, display_name from users where id = ${id}
  `) as { id: string; display_name: string }[];
  if (rows.length === 0) throw notFound('No such Widget ID');

  return json(await publicStats(rows[0].id, rows[0].display_name));
});
