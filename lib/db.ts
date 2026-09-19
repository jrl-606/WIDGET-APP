import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let client: NeonQueryFunction<false, false> | null = null;

function connect(): NeonQueryFunction<false, false> {
  if (client) return client;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local.');
  }
  client = neon(connectionString);
  return client;
}

/**
 * Tagged-template SQL client. Interpolated values are sent as bind
 * parameters, never string-concatenated:
 *
 *   await sql`select * from users where id = ${id}`
 *
 * Connection is established on first query rather than at import, so
 * `next build` can compile the routes without a live DATABASE_URL.
 */
export const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
  (connect() as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>)(
    strings,
    ...values,
  )) as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
