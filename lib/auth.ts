import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { unauthorized } from './http';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * `createRemoteJWKSet` caches the key set and only re-fetches on an unknown
 * `kid`, so the instance is reused across warm invocations. It is built on
 * first use rather than at import so `next build` needs no live env.
 */
function keySet(): ReturnType<typeof createRemoteJWKSet> {
  if (jwks) return jwks;
  const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
  if (!jwksUrl) {
    throw new Error('NEON_AUTH_JWKS_URL is not set. Copy .env.example to .env.local.');
  }
  jwks = createRemoteJWKSet(new URL(jwksUrl));
  return jwks;
}

export type VerifiedSession = {
  /** `neon_auth.user.id` — the UUID this API's `users.auth_user_id` points at. */
  authUserId: string;
  email: string | null;
  name: string | null;
  claims: JWTPayload;
};

function bearerFrom(req: Request): string {
  const header = req.headers.get('authorization') ?? '';
  const [scheme, ...rest] = header.split(' ');
  const token = rest.join(' ').trim();
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw unauthorized('Expected an "Authorization: Bearer <token>" header');
  }
  return token;
}

/**
 * Verifies a Better Auth session JWT against Neon's JWKS endpoint. The
 * signature is the only thing trusted here — no identity is ever read from a
 * request body or query string.
 */
export async function verifySession(req: Request): Promise<VerifiedSession> {
  const token = bearerFrom(req);

  const issuer = process.env.NEON_AUTH_ISSUER || process.env.NEON_AUTH_BASE_URL;

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keySet(), issuer ? { issuer } : undefined));
  } catch {
    throw unauthorized('Session token failed verification');
  }

  const authUserId = typeof payload.sub === 'string' ? payload.sub : null;
  if (!authUserId) throw unauthorized('Session token has no subject');

  return {
    authUserId,
    email: typeof payload.email === 'string' ? payload.email : null,
    name: typeof payload.name === 'string' ? payload.name : null,
    claims: payload,
  };
}
