import { currentUser } from '@/lib/currentUser';
import { sql } from '@/lib/db';
import {
  hasExpired,
  hasStarted,
  isRepeatOption,
  serializeGoal,
  VALID_SCORES,
  type GoalRow,
} from '@/lib/goals';
import {
  badRequest,
  conflict,
  forbidden,
  handler,
  json,
  notFound,
  optionalInt,
  optionalString,
  readJson,
  requireTimestamp,
} from '@/lib/http';
import { isCategory } from '@/lib/ranks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOwnGoal(goalId: string, userId: string): Promise<GoalRow> {
  if (!UUID_RE.test(goalId)) throw notFound('Goal not found');
  const rows = (await sql`select * from goals where id = ${goalId}`) as GoalRow[];
  if (rows.length === 0) throw notFound('Goal not found');
  if (rows[0].user_id !== userId) throw forbidden('That goal is not yours');
  return rows[0];
}

/** GET /api/goals/:id — 403s unless you own it. */
export const GET = handler<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const me = await currentUser(req);
  const goal = await loadOwnGoal(id, me.id);
  return json({ goal: serializeGoal(goal) });
});

/**
 * PATCH /api/goals/:id
 *
 * Two distinct operations on your own goal, gated by where the goal is in its
 * life cycle:
 *   - score  — only once the goal has expired, and only once;
 *   - edit   — only before the goal has started.
 *
 * There is no DELETE here or anywhere else: goals can never be deleted.
 */
export const PATCH = handler<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const me = await currentUser(req);
  const goal = await loadOwnGoal(id, me.id);
  const body = await readJson(req);
  const now = new Date();

  const isScoring = body.score !== undefined || body.scoreNotes !== undefined;

  if (isScoring) {
    const editFields = Object.keys(body).filter((key) => key !== 'score' && key !== 'scoreNotes');
    if (editFields.length > 0) {
      throw badRequest('Scoring and editing are separate operations — send them separately');
    }
    if (!hasExpired(goal, now)) throw conflict('A goal can only be scored after it expires');
    if (goal.score !== null) throw conflict('That goal has already been scored');

    const score = body.score;
    if (typeof score !== 'number' || !(VALID_SCORES as readonly number[]).includes(score)) {
      throw badRequest(`"score" must be one of ${VALID_SCORES.join(', ')}`);
    }
    const scoreNotes = optionalString(body, 'scoreNotes', { max: 5000 });

    const rows = (await sql`
      update goals set score = ${score}, score_notes = ${scoreNotes}
      where id = ${goal.id} and score is null
      returning *
    `) as GoalRow[];
    if (rows.length === 0) throw conflict('That goal has already been scored');

    return json({ goal: serializeGoal(rows[0], now) });
  }

  if (hasStarted(goal, now)) throw conflict('A goal can only be edited before it starts');

  const category = body.category === undefined ? goal.category : body.category;
  if (!isCategory(category)) throw badRequest('"category" must be a known life area');

  const repeat = body.repeat === undefined ? goal.repeat : body.repeat;
  if (!isRepeatOption(repeat)) throw badRequest('"repeat" must be a known cadence');

  let title = goal.title;
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      throw badRequest('"title" must be a non-empty string');
    }
    title = body.title.trim().slice(0, 200);
  }

  const startAt =
    body.startAt === undefined ? new Date(goal.start_at) : requireTimestamp(body, 'startAt');
  const durationMin =
    optionalInt(body, 'durationMin', { min: 0, max: 60 * 24 * 365 }) ?? goal.duration_min;
  const alertMin = optionalInt(body, 'alertMin', { min: 0, max: 60 * 24 * 7 }) ?? goal.alert_min;
  const sub = body.sub === undefined ? goal.sub : optionalString(body, 'sub', { max: 200 });
  const phone = body.phone === undefined ? goal.phone : optionalString(body, 'phone', { max: 40 });
  const address =
    body.address === undefined ? goal.address : optionalString(body, 'address', { max: 500 });
  const notes =
    body.notes === undefined ? goal.notes : optionalString(body, 'notes', { max: 5000 });

  // `start_at > now()` re-checks the pre-start window inside the write, so a
  // goal that starts between the read above and this update stays immutable.
  const rows = (await sql`
    update goals set
      category = ${category},
      sub = ${sub},
      title = ${title},
      start_at = ${startAt.toISOString()},
      duration_min = ${durationMin},
      alert_min = ${alertMin},
      repeat = ${repeat},
      phone = ${phone},
      address = ${address},
      notes = ${notes}
    where id = ${goal.id} and start_at > now()
    returning *
  `) as GoalRow[];
  if (rows.length === 0) throw conflict('A goal can only be edited before it starts');

  return json({ goal: serializeGoal(rows[0], now) });
});
