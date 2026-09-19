#!/usr/bin/env bash
#
# End-to-end smoke test for widget-api.
#
# Signs up two throwaway accounts against Neon Auth, then drives every route
# with their real session tokens: the goal life cycle and its guards, public
# vs. private stats, DMs, group invites, and group isolation.
#
# Needs a server already running (npm run dev, or npm run build && npm start)
# and outbound network access to both Neon Auth and the Neon database.
#
#   API=http://localhost:3000 ./scripts/smoke.sh
#
set -uo pipefail

API=${API:-http://localhost:3000}
AUTH=${NEON_AUTH_BASE_URL:-}

if [ -z "$AUTH" ] && [ -f .env.local ]; then
  AUTH=$(grep -E '^NEON_AUTH_BASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"')
fi
if [ -z "$AUTH" ]; then
  echo "Set NEON_AUTH_BASE_URL (or put it in .env.local) first." >&2
  exit 1
fi

pass=0
fail=0

signup() { # email -> token on stdout
  curl -sS -X POST "$AUTH/sign-up/email" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"Smoke-passw0rd!\",\"name\":\"$2\"}" |
    python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("token") or d.get("session",{}).get("token",""))'
}

# check <expected-status> <label> <method> <path> <token> [body]
check() {
  local want=$1 label=$2 method=$3 path=$4 token=$5 body=${6:-}
  local args=(-sS -o /tmp/smoke.out -w '%{http_code}' -X "$method" "$API$path")
  [ -n "$token" ] && args+=(-H "authorization: Bearer $token")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  local got
  got=$(curl "${args[@]}")
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
    printf '  ok   %-48s %s\n' "$label" "$got"
  else
    fail=$((fail + 1))
    printf '  FAIL %-48s want %s got %s\n       %s\n' "$label" "$want" "$got" "$(head -c 200 /tmp/smoke.out)"
  fi
}

body() { python3 -c "import json,sys;print(json.load(sys.stdin)$1)" < /tmp/smoke.out; }

stamp=$(date +%s)
A=$(signup "smoke-a-$stamp@example.com" "Smoke A")
B=$(signup "smoke-b-$stamp@example.com" "Smoke B")
if [ -z "$A" ] || [ -z "$B" ]; then
  echo "Sign-up did not return a session token — is email/password enabled?" >&2
  exit 1
fi

echo "auth"
check 401 "GET  /api/auth/me   (no token)"        GET /api/auth/me ""
check 401 "GET  /api/auth/me   (bad token)"       GET /api/auth/me "not.a.token"
check 200 "GET  /api/auth/me   (A, mints ID)"     GET /api/auth/me "$A"
AID=$(body "['userId']")
check 200 "GET  /api/auth/me   (B, mints ID)"     GET /api/auth/me "$B"
BID=$(body "['userId']")
check 200 "GET  /api/auth/me   (A, stable ID)"    GET /api/auth/me "$A"
[ "$(body "['userId']")" = "$AID" ] &&
  { pass=$((pass + 1)); echo "  ok   Widget ID is stable across calls"; } ||
  { fail=$((fail + 1)); echo "  FAIL Widget ID changed between calls"; }

echo "users"
check 200 "PATCH /api/users    (rename self)"     PATCH /api/users "$A" '{"displayName":"Smoke A renamed"}'
check 400 "PATCH /api/users    (blank name)"      PATCH /api/users "$A" '{"displayName":"   "}'

echo "goals"
past=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.UTC)-datetime.timedelta(hours=3)).isoformat())")
future=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.UTC)+datetime.timedelta(days=2)).isoformat())")
check 201 "POST /api/goals     (expired goal)"    POST /api/goals "$A" "{\"category\":\"Finances\",\"title\":\"Smoke expired\",\"startAt\":\"$past\",\"durationMin\":60}"
PAST_ID=$(body "['goal']['id']")
check 201 "POST /api/goals     (future goal)"     POST /api/goals "$A" "{\"category\":\"Education\",\"title\":\"Smoke future\",\"startAt\":\"$future\",\"durationMin\":30,\"repeat\":\"Weekly\"}"
FUT_ID=$(body "['goal']['id']")
check 400 "POST /api/goals     (bad category)"    POST /api/goals "$A" "{\"category\":\"Nope\",\"title\":\"x\",\"startAt\":\"$future\"}"
check 400 "POST /api/goals     (no title)"        POST /api/goals "$A" "{\"category\":\"Business\",\"startAt\":\"$future\"}"
check 401 "GET  /api/goals     (no token)"        GET /api/goals ""
check 200 "GET  /api/goals     (own list)"        GET /api/goals "$A"
check 200 "GET  /api/goals     (?category=)"      GET "/api/goals?category=Finances" "$A"
check 200 "GET  /api/goals     (?scored=false)"   GET "/api/goals?scored=false" "$A"
check 200 "GET  /api/goals/:id (owner)"           GET "/api/goals/$PAST_ID" "$A"
check 403 "GET  /api/goals/:id (not owner)"       GET "/api/goals/$PAST_ID" "$B"
check 404 "GET  /api/goals/:id (unknown)"         GET "/api/goals/00000000-0000-4000-8000-000000000000" "$A"
check 200 "PATCH goal          (score expired)"   PATCH "/api/goals/$PAST_ID" "$A" '{"score":3,"scoreNotes":"fine"}'
check 409 "PATCH goal          (score twice)"     PATCH "/api/goals/$PAST_ID" "$A" '{"score":5}'
check 400 "PATCH goal          (score not 0/1/3/5)" PATCH "/api/goals/$FUT_ID" "$A" '{"score":4}'
check 409 "PATCH goal          (score pre-expiry)" PATCH "/api/goals/$FUT_ID" "$A" '{"score":5}'
check 200 "PATCH goal          (edit pre-start)"  PATCH "/api/goals/$FUT_ID" "$A" '{"title":"Smoke future v2","notes":"edited"}'
check 409 "PATCH goal          (edit post-start)" PATCH "/api/goals/$PAST_ID" "$A" '{"title":"nope"}'
check 400 "PATCH goal          (score + edit)"    PATCH "/api/goals/$FUT_ID" "$A" '{"score":1,"title":"x"}'
check 403 "PATCH goal          (not owner)"       PATCH "/api/goals/$FUT_ID" "$B" '{"title":"stolen"}'
check 405 "DELETE goal         (must not exist)"  DELETE "/api/goals/$FUT_ID" "$A"

echo "stats"
check 200 "GET  rank           (public, no auth)" GET "/api/users/$AID/rank" ""
check 404 "GET  rank           (unknown id)"      GET "/api/users/NOBODY42/rank" ""
check 200 "GET  private-stats  (self)"            GET "/api/users/$AID/private-stats" "$A"
check 403 "GET  private-stats  (someone else)"    GET "/api/users/$AID/private-stats" "$B"
check 401 "GET  private-stats  (no token)"        GET "/api/users/$AID/private-stats" ""

echo "dm"
check 201 "POST /api/dm/:other (A to B)"          POST "/api/dm/$BID" "$A" '{"body":"hello"}'
check 201 "POST /api/dm/:other (B to A)"          POST "/api/dm/$AID" "$B" '{"body":"got it"}'
check 200 "GET  /api/dm/:other (A sees both)"     GET "/api/dm/$BID" "$A"
check 200 "GET  /api/dm/:other (B sees both)"     GET "/api/dm/$AID" "$B"
check 400 "POST /api/dm/:self"                    POST "/api/dm/$AID" "$A" '{"body":"x"}'
check 404 "POST /api/dm/:unknown"                 POST "/api/dm/NOBODY42" "$A" '{"body":"x"}'
check 401 "GET  /api/dm/:other (no token)"        GET "/api/dm/$BID" ""

echo "groups"
check 201 "POST /api/groups    (create)"          POST /api/groups "$A" '{"name":"Smoke Group"}'
GID=$(body "['group']['id']")
check 200 "GET  /api/groups    (owner sees it)"   GET /api/groups "$A"
check 201 "POST invite         (owner invites B)" POST "/api/groups/$GID/invite" "$A" "{\"userId\":\"$BID\"}"
check 409 "POST invite         (twice)"           POST "/api/groups/$GID/invite" "$A" "{\"userId\":\"$BID\"}"
check 403 "POST invite         (non-owner)"       POST "/api/groups/$GID/invite" "$B" "{\"userId\":\"$AID\"}"
check 404 "POST invite         (unknown user)"    POST "/api/groups/$GID/invite" "$A" '{"userId":"NOBODY42"}'
check 403 "GET  members        (pending invitee)" GET "/api/groups/$GID/members" "$B"
check 403 "GET  messages       (pending invitee)" GET "/api/groups/$GID/messages" "$B"
check 200 "POST respond        (B accepts)"       POST "/api/groups/$GID/respond" "$B" '{"action":"accept"}'
check 409 "POST respond        (already member)"  POST "/api/groups/$GID/respond" "$B" '{"action":"accept"}'
check 200 "GET  members        (B is in)"         GET "/api/groups/$GID/members" "$B"
check 201 "POST messages       (B posts)"         POST "/api/groups/$GID/messages" "$B" '{"body":"hi group"}'
check 200 "GET  messages       (A reads)"         GET "/api/groups/$GID/messages" "$A"
check 400 "POST respond        (bad action)"      POST "/api/groups/$GID/respond" "$B" '{"action":"maybe"}'

check 201 "POST /api/groups    (A-only group)"    POST /api/groups "$A" '{"name":"Smoke Private"}'
PGID=$(body "['group']['id']")
check 403 "GET  messages       (isolated from B)" GET "/api/groups/$PGID/messages" "$B"
check 404 "GET  members        (unknown group)"   GET "/api/groups/g_missing/members" "$A"
check 404 "POST respond        (no invite)"       POST "/api/groups/$PGID/respond" "$B" '{"action":"accept"}'

for n in 3 4 5; do
  check 201 "POST /api/groups    (owned #$n)"     POST /api/groups "$A" "{\"name\":\"Smoke Cap $n\"}"
done
check 409 "POST /api/groups    (6th is capped)"   POST /api/groups "$A" '{"name":"Smoke Cap 6"}'

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]
