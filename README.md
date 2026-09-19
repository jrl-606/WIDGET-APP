# widget-api

A Next.js (App Router) API layer over the `widget-app` Neon Postgres
project, covering users, goals, private messages, and groups — the
server-side equivalent of what WIDGET currently keeps in `window.storage`.
Every route is backed by **real authentication** via Neon Auth
(Better Auth, provisioned directly on this project).

## Status: real backend, real auth, still not connected to the WIDGET app

This is genuinely working, deployable code with cryptographic auth — but
**nothing in the live WIDGET artifact calls it yet.** The artifact runs
inside Claude's published-page sandbox, which only permits network requests
to a short host whitelist (a few CDN script hosts, Google Fonts, and
Anthropic's own API). Neon's endpoints aren't on that list and can't be
added to it. This project and WIDGET are still two separate things that
happen to share a data model, until WIDGET is rebuilt as a real standalone
web app outside the sandbox.

`AUTH-PLAN.md` is the step-by-step plan for the Neon → Vercel → Cursor
loop: what is already provisioned, what you run where, and in what order.

## How auth actually works here

Neon Auth (Better Auth) is provisioned on the `widget-app` project
(`wandering-union-01244703`, branch `main`). Real schema exists in Postgres:
`neon_auth.user`, `session`, `account`, `verification`, `jwks`, etc. — not a
stub.

**The flow:**

1. A client signs in via Better Auth (email/password is enabled by default;
   Google OAuth is listed but needs a real client ID/secret added via
   `add_auth_oauth_provider` before it's usable).
2. Better Auth issues a session JWT.
3. The client calls `GET /api/auth/me` with `Authorization: Bearer <token>`.
   This verifies the token against Neon's JWKS endpoint and returns the
   caller's Widget ID — **minting one and linking it to the verified
   account the first time that account is ever seen.**
4. Every other route requires that same bearer token. Nothing trusts a
   `userId` typed into a request body or query string. Identity comes from
   `lib/auth.ts` verifying the JWT signature, then `lib/currentUser.ts`
   resolving it to a Widget ID via the `users.auth_user_id` column (a real
   foreign key into `neon_auth.user`).

`POST /api/users` (which would let anyone claim any Widget ID + name) does
not exist — the sign-in + `/api/auth/me` flow replaces it. The
`private-stats`, group-invite, group-respond, and group-members/messages
routes all check that the caller IS who they claim.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL from the Neon console
npm run dev
```

`.env.local` is gitignored and must stay that way — it holds a live database
credential. Rotate the DB password if it has ever been shared.

A frontend calling this API needs the Better Auth client SDK pointed at
`NEON_AUTH_BASE_URL` to handle sign-in/sign-up and obtain the session token
to send as `Authorization: Bearer <token>` on every request below.

## Schema

Six app tables (`users`, `goals`, `dm_messages`, `groups`, `group_members`,
`group_messages`) plus `users.auth_user_id`, a `UUID` foreign key into
`neon_auth.user(id)`. `db/schema.sql` is the checked-in copy, re-runnable
against a fresh branch.

Facts the routes enforce, mirroring the database constraints:

- `goals.category` is one of **Personal Life, Business, Finances, Education,
  Mental Health**.
- `goals.score` is one of **0, 1, 3, 5**, set once and only after the goal
  expires (`start_at + duration_min`).
- A goal is editable only *before* `start_at`. Both windows are re-checked
  inside the `UPDATE` itself, so a goal can't slip through a race.
- `dm_messages` stores one row per pair with `user_a < user_b`; the API
  canonicalises the pair, so conversation history is symmetric.
- `group_members.status` is `pending` or `member`. Declining an invite
  deletes the row.
- **No DELETE exists for goals, anywhere.** Goals can never be deleted.

Rank thresholds live in `lib/ranks.ts`. The WIDGET client keeps the same
ladder in `RANKS` / `rankFor()` in `widget-beta.jsx`; that file isn't in this
repo, so **reconcile the two before shipping** — if the app's ladder differs,
copy it into `lib/ranks.ts` verbatim and update both from then on.

## Endpoints

All routes require `Authorization: Bearer <token>` unless noted.

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/me` | GET | Verify session, return (or mint) your Widget ID |
| `/api/users` | PATCH | Update your own display name |
| `/api/users/:id/rank` | GET | **Public**, no auth — rank + points per life area (no goal counts) |
| `/api/users/:id/private-stats` | GET | Full stats incl. goal counts — 403s unless `:id` is you |
| `/api/goals` | GET | List your own goals (`?category=`, `?scored=`, `?limit=`) |
| `/api/goals` | POST | Create a goal, attributed to you |
| `/api/goals/:id` | GET | Fetch one goal — 403s unless you own it |
| `/api/goals/:id` | PATCH | Score (post-expiry) or edit (pre-start) your own goal — no DELETE exists anywhere: goals can never be deleted |
| `/api/dm/:otherId` | GET | Message history between you and `:otherId` |
| `/api/dm/:otherId` | POST | Send a DM as you |
| `/api/groups` | GET | Groups you own, belong to, or are invited to |
| `/api/groups` | POST | Create a group as you (max 5 owned) |
| `/api/groups/:groupId/invite` | POST | Invite by Widget ID — 403s unless you own the group |
| `/api/groups/:groupId/respond` | POST | Accept/decline your own pending invite |
| `/api/groups/:groupId/members` | GET | Member names + ranks — 403s unless you're a member |
| `/api/groups/:groupId/messages` | GET/POST | Isolated group chat — 403s unless you're a member |

Errors are always `{ "error": "<message>" }` with a meaningful status:
`400` malformed input, `401` missing/invalid token, `403` not yours,
`404` unknown ID, `409` wrong point in a goal's or invite's life cycle.

## Testing

`scripts/smoke.sh` drives every endpoint end to end against a running server
— sign-in through two accounts, then the goal life cycle, DMs, group invites
and isolation. It needs network access to both Neon Auth and the Neon
database, so run it from a normal dev machine:

```bash
npm run build && npm start &
./scripts/smoke.sh                 # signs up two throwaway accounts
```

## What's still open

- **Google OAuth** is listed as available but has no client ID/secret
  configured — email/password sign-in works out of the box, social login
  doesn't yet.
- **Rate limiting / abuse protection** isn't implemented — auth stops
  identity spoofing, not high-volume abuse from a legitimately signed-in
  account.
- **The rank ladder** in `lib/ranks.ts` still needs reconciling with
  `widget-beta.jsx` (see Schema above).
- **This still can't be called from the live WIDGET artifact**, for the
  sandbox reason explained at the top. That's the piece that actually
  requires taking WIDGET outside Claude's artifact environment.
