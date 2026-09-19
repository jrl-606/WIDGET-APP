import { currentUser } from '@/lib/currentUser';
import { forbidden, handler, json } from '@/lib/http';
import { privateStats } from '@/lib/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/users/:id/private-stats
 * Full stats including goal counts. 403s unless `:id` is the verified caller.
 */
export const GET = handler<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const me = await currentUser(req);
  if (id !== me.id) throw forbidden('You can only read your own private stats');

  return json(await privateStats(me.id, me.displayName));
});
