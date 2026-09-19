# Backend auth plan — Neon → Vercel → Cursor

The code in this repo is finished and builds; what follows is the operational
plan to get it live and keep working on it. Phase 0 is the verified starting
state, phases 1–5 are the work.

Every claim in Phase 0 was read back from the live Neon project on
2026-09-19; everything after it is a step someone still has to run.

---

## Phase 0 — What already exists (verified, no action needed)

| Thing | Value |
|---|---|
| Neon project | `widget-app` — `wandering-union-01244703`, AWS `us-west-2`, PG 18 |
| Default branch | `main` — `br-twilight-credit-ar59h1qc`, database `neondb` |
| Auth provider | Neon Auth / Better Auth, provisioned 2026-09-19 |
| Auth base URL | `https://ep-polished-breeze-ar9wxxf6.neonauth.c-4.us-west-2.aws.neon.tech/neondb/auth` |
| JWKS URL | the same base + `/.well-known/jwks.json` |
| Sign-in methods | email + password, sign-up open, email verification **off** |
| OAuth | `google` listed as `shared`, **no client ID/secret** — unusable as-is |
| Trusted origins | **empty**; `allow_localhost: true` |
| App schema | `users`, `goals`, `dm_messages`, `groups`, `group_members`, `group_messages` |
| Auth link | `users.auth_user_id uuid unique references neon_auth."user"(id)` |

Constraints the API depends on and that are really in the database:
`goals.category` ∈ (Personal Life, Business, Finances, Education, Mental
Health); `goals.score` ∈ (0, 1, 3, 5); `group_members.status` ∈ (pending,
member); `dm_messages` has `check (user_a < user_b)`.

---

## Phase 1 — Neon

Ordered by how much it blocks everything else.

**1.1 Rotate the database credential (do this first).**
The `neondb_owner` password has been pasted into a README and shared in
chat, so treat it as public. Neon console → Project → Roles →
`neondb_owner` → Reset password, then update `.env.local` and the Vercel
env vars in Phase 2. Nothing else in this repo has to change.

**1.2 Add trusted origins before any deployed frontend signs in.**
`trusted_origins` is empty today, which is fine for localhost only. Add each
origin that will host a sign-in page — production domain first, then the
Vercel preview domain pattern if you want previews to authenticate:

- `https://<your-domain>`
- `https://<project>.vercel.app`

Use `add_auth_trusted_domain` (Neon MCP) or the Neon console → Auth →
Settings. Leave `allow_localhost: true` while developing; turn it off for a
locked-down production project.

**1.3 Decide on email verification.** Currently off, so anyone can sign up
with an address they don't own and immediately mint a Widget ID. Turn
`require_email_verification` on before real users exist
(`update_auth_config`), and keep in mind the shared sender
(`auth@mail.myneon.app`) is fine for testing but you'll want your own SMTP
for production deliverability.

**1.4 Google OAuth (optional, currently broken by omission).**
Create an OAuth client in Google Cloud Console, redirect URI
`<NEON_AUTH_BASE_URL>/callback/google`, then attach the client ID/secret
with `add_auth_oauth_provider` (or update the existing shared entry with
`update_auth_oauth_provider`). No API code changes — the token verification
path is identical whatever the sign-in method.

**1.5 Branch-per-environment.** Keep `main` as production. Create a
long-lived `dev` branch for local work, and let Vercel previews get their
own ephemeral branches (Phase 2.3). `db/schema.sql` rebuilds the app tables
on any fresh branch; `neon_auth.*` comes along with the branch automatically.

**1.6 Least-privilege role (recommended, not blocking).**
The API only needs DML on the six app tables plus `select` on
`neon_auth."user"`. Create a `widget_api` role with exactly that instead of
deploying with `neondb_owner`:

```sql
create role widget_api login password '<generated>';
grant usage on schema public to widget_api;
grant select, insert, update on all tables in schema public to widget_api;
grant usage, select on all sequences in schema public to widget_api;
grant usage on schema neon_auth to widget_api;
grant select on neon_auth."user" to widget_api;
-- deliberately no DELETE on goals, matching the "goals are permanent" rule
```

---

## Phase 2 — Vercel

**2.1 Import the repo.** Vercel → Add New → Project → import this
repository. Framework preset: Next.js. Build command, output and install
step are all defaults — no `vercel.json` is needed.

**2.2 Environment variables.** Set these for **Production**, **Preview** and
**Development** (Vercel → Project → Settings → Environment Variables). The
names match `.env.example` exactly:

| Name | Value | Notes |
|---|---|---|
| `DATABASE_URL` | pooled Neon URI (`-pooler` host), post-rotation | **secret** |
| `NEON_AUTH_BASE_URL` | Phase 0 base URL | public |
| `NEON_AUTH_JWKS_URL` | Phase 0 JWKS URL | public |
| `NEXT_PUBLIC_NEON_AUTH_BASE_URL` | same base URL | shipped to the browser |

Use the **pooled** connection string: every route is a serverless function
and opens its own connection. `NEON_AUTH_ISSUER` is optional — it defaults
to `NEON_AUTH_BASE_URL`, which is what Better Auth puts in `iss`.

**2.3 Install the Neon–Vercel integration.** It wires each Vercel preview
deployment to a fresh Neon branch and injects that branch's `DATABASE_URL`
automatically, so preview deployments never write to production data. Do
this instead of hand-copying preview credentials.

**2.4 Region.** Put the functions in the region nearest the database
(`us-west-2` → `pdx1`) to keep round trips short. Vercel → Settings →
Functions → Region.

**2.5 Verify the deployment before pointing anything at it.**

```bash
curl -i https://<deployment>/api/auth/me                    # expect 401
curl -i https://<deployment>/api/users/SOMEID/rank          # expect 404 (public route, reached)
```

A 401 from the first and a 404 (not a 500) from the second means env vars,
the database connection and JWKS wiring are all good. Then run
`API=https://<deployment> ./scripts/smoke.sh` for the full pass.

**2.6 Guard rails.** Turn on Vercel's deployment protection for previews if
the data is real, and remember the README's open item: **there is no rate
limiting**. Vercel WAF / rate limiting rules on `/api/*` are the cheapest
place to add it.

---

## Phase 3 — Cursor

**3.1 Local env.** `cp .env.example .env.local`, fill in the rotated
`DATABASE_URL`, `npm install`, `npm run dev`. `.env.local` is gitignored —
keep it that way; the earlier README shipped a live credential in the repo
and that is exactly what Phase 1.1 is cleaning up.

**3.2 Add the Neon MCP server** so schema work happens in the editor instead
of the console. In Cursor → Settings → MCP, or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": ["-y", "@neondatabase/mcp-server-neon", "start", "<NEON_API_KEY>"]
    }
  }
}
```

Put the API key in your own machine's config, not in the repo. With it,
"add a column and migrate" and "show me the constraints on `goals`" work
without leaving the editor. The Vercel MCP server is worth adding the same
way for deployment logs.

**3.3 Project rules.** Add `.cursor/rules/widget-api.mdc` with the
invariants a model will otherwise break:

- Identity always comes from `currentUser(req)`. Never read a user ID from a
  request body, query string, or header other than the verified bearer token.
- Never add a DELETE route for goals.
- Scoring and editing are separate operations with separate windows
  (post-expiry / pre-start), and both windows are re-checked in the `UPDATE`.
- Any new table gets a foreign key to `users(id)`, and any new route gets an
  ownership or membership check before it touches rows.
- Keep `lib/ranks.ts` and `widget-beta.jsx`'s `RANKS` identical.

**3.4 The loop.** Branch → edit in Cursor → `npm run typecheck && npm run
build` → push → Vercel preview (on its own Neon branch) → `API=<preview-url>
./scripts/smoke.sh` → merge. Schema changes go through
`prepare_database_migration` / `complete_database_migration` on a Neon
branch first, then into `db/schema.sql` in the same PR as the code that
needs them.

---

## Phase 4 — Wiring a frontend to this API

1. `npm i better-auth` in the frontend and point the client at
   `NEXT_PUBLIC_NEON_AUTH_BASE_URL`.
2. Sign-up/sign-in through the Better Auth client; hold the session token.
3. Call `GET /api/auth/me` once after sign-in — that is what mints and
   returns the Widget ID. Cache it; it never changes for that account.
4. Send `Authorization: Bearer <token>` on every other call.
5. Handle `401` by re-authenticating and `403` as a real permission error —
   they mean different things everywhere in this API.

## Phase 5 — The part that isn't solved by any of this

The live WIDGET artifact still cannot call this API: the published-page
sandbox allows requests only to a short host whitelist, and Neon isn't on it
and can't be added. Deploying to Vercel does not change that — a Vercel
domain isn't whitelisted either. The only real fix is rebuilding WIDGET as a
standalone web app outside the artifact sandbox, at which point Phase 4 is
all that's left.

---

## Checklist

- [ ] 1.1 Rotate `neondb_owner` password, update `.env.local`
- [ ] 1.2 Add trusted origins for the deployed frontend
- [ ] 1.3 Decide on email verification before real sign-ups
- [ ] 1.4 Google OAuth client ID/secret (optional)
- [ ] 1.5 `dev` branch for local work
- [ ] 1.6 `widget_api` least-privilege role (recommended)
- [ ] 2.1 Import repo into Vercel
- [ ] 2.2 Four env vars in all three environments
- [ ] 2.3 Neon–Vercel integration for preview branches
- [ ] 2.4 Functions region `pdx1`
- [ ] 2.5 `401` + `404` verification, then `scripts/smoke.sh`
- [ ] 2.6 Rate limiting on `/api/*`
- [ ] 3.2 Neon MCP server in Cursor
- [ ] 3.3 `.cursor/rules` with the invariants
- [ ] 4 Frontend Better Auth client + `/api/auth/me`
- [ ] Reconcile `lib/ranks.ts` with `RANKS` in `widget-beta.jsx`
