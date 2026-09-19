import { currentUser } from '@/lib/currentUser';
import { handler, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 * Verifies the bearer session and returns the caller's Widget ID, minting and
 * linking one the first time this account is seen.
 */
export const GET = handler(async (req: Request) => {
  const me = await currentUser(req);
  return json({
    userId: me.id,
    displayName: me.displayName,
    authUserId: me.authUserId,
    email: me.session.email,
  });
});
