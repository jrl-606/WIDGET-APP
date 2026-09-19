import { currentUser } from '@/lib/currentUser';
import { sql } from '@/lib/db';
import { isRepeatOption, serializeGoal, type GoalRow } from '@/lib/goals';
import {
  badRequest,
  handler,
  json,
  optionalInt,
  optionalString,
  pageLimit,
  readJson,
  requireString,
  requireTimestamp,
} from '@/lib/http';
import { isCategory } from '@/lib/ranks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/goals
 * Your own goals, newest start first. `?category=` and `?scored=true|false`
 * narrow the list; `?limit=` caps it.
 */
export const GET = handler(async (req: Request) => {
  const me = await currentUser(req);
  const params = new URL(req.url).searchParams;
  const limit = pageLimit(req);

  const category = params.get('category');
  if (category !== null && !isCategory(category)) throw badRequest('Unknown "category"');

  const scoredParam = params.get('scored');
  if (scoredParam !== null && scoredParam !== 'true' && scoredParam !== 'false') {
    throw badRequest('"scored" must be true or false');
  }
  const scored = scoredParam === null ? null : scoredParam === 'true';

  const rows = (await sql`
    select * from goals
    where user_id = ${me.id}
      and (${category}::text is null or category = ${category})
      and (
        ${scored}::boolean is null
        or (${scored}::boolean and score is not null)
        or (not ${scored}::boolean and score is null)
      )
    order by start_at desc, created_at desc
    limit ${limit}
  `) as GoalRow[];

  const now = new Date();
  return json({ goals: rows.map((row) => serializeGoal(row, now)) });
});

/**
 * POST /api/goals
 * Creates a goal attributed to the verified caller — the body cannot name a
 * different owner.
 */
export const POST = handler(async (req: Request) => {
  const me = await currentUser(req);
  const body = await readJson(req);

  const category = body.category;
  if (!isCategory(category)) throw badRequest('"category" must be a known life area');

  const title = requireString(body, 'title', { max: 200 });
  const sub = optionalString(body, 'sub', { max: 200 });
  const startAt = requireTimestamp(body, 'startAt');
  const durationMin = optionalInt(body, 'durationMin', { min: 0, max: 60 * 24 * 365 }) ?? 0;
  const alertMin = optionalInt(body, 'alertMin', { min: 0, max: 60 * 24 * 7 }) ?? 0;
  const phone = optionalString(body, 'phone', { max: 40 });
  const address = optionalString(body, 'address', { max: 500 });
  const notes = optionalString(body, 'notes', { max: 5000 });

  const repeat = body.repeat === undefined || body.repeat === null ? 'None' : body.repeat;
  if (!isRepeatOption(repeat)) throw badRequest('"repeat" must be a known cadence');

  const rows = (await sql`
    insert into goals (
      user_id, category, sub, title, start_at, duration_min, alert_min,
      repeat, phone, address, notes
    )
    values (
      ${me.id}, ${category}, ${sub}, ${title}, ${startAt.toISOString()}, ${durationMin},
      ${alertMin}, ${repeat}, ${phone}, ${address}, ${notes}
    )
    returning *
  `) as GoalRow[];

  return json({ goal: serializeGoal(rows[0]) }, 201);
});
