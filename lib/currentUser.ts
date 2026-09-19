import { sql } from './db';
import { verifySession, type VerifiedSession } from './auth';
import { ApiError } from './http';

export type CurrentUser = {
  /** Widget ID — the `users.id` every app table keys off. */
  id: string;
  displayName: string;
  authUserId: string;
  session: VerifiedSession;
};

type UserRow = { id: string; display_name: string };

// Crockford-ish alphabet: no I, L, O, U, so IDs stay readable out loud.
const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 7;

function mintWidgetId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  let id = 'W';
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}

function fallbackName(session: VerifiedSession): string {
  if (session.name) return session.name.slice(0, 80);
  if (session.email) return session.email.split('@')[0].slice(0, 80);
  return 'Widget user';
}

/**
 * Resolves a verified session to a Widget ID, minting and linking one the
 * first time an authenticated account is seen. The insert is guarded by the
 * `users_auth_user_id_key` unique constraint, so two concurrent first requests
 * can't create two Widget IDs for the same account.
 */
export async function currentUser(req: Request): Promise<CurrentUser> {
  const session = await verifySession(req);

  const existing = (await sql`
    select id, display_name from users where auth_user_id = ${session.authUserId}
  `) as UserRow[];

  if (existing.length > 0) {
    return {
      id: existing[0].id,
      displayName: existing[0].display_name,
      authUserId: session.authUserId,
      session,
    };
  }

  const displayName = fallbackName(session);

  // Retry only guards against an ID collision; a race on auth_user_id resolves
  // via the re-select below.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inserted = (await sql`
      insert into users (id, display_name, auth_user_id)
      values (${mintWidgetId()}, ${displayName}, ${session.authUserId})
      on conflict do nothing
      returning id, display_name
    `) as UserRow[];

    if (inserted.length > 0) {
      return {
        id: inserted[0].id,
        displayName: inserted[0].display_name,
        authUserId: session.authUserId,
        session,
      };
    }

    const raced = (await sql`
      select id, display_name from users where auth_user_id = ${session.authUserId}
    `) as UserRow[];

    if (raced.length > 0) {
      return {
        id: raced[0].id,
        displayName: raced[0].display_name,
        authUserId: session.authUserId,
        session,
      };
    }
  }

  throw new ApiError(500, 'Could not allocate a Widget ID');
}
