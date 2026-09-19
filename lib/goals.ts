import type { Category } from './ranks';

export type GoalRow = {
  id: string;
  user_id: string;
  category: Category;
  sub: string | null;
  title: string;
  start_at: string;
  duration_min: number;
  alert_min: number;
  repeat: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  score: number | null;
  score_notes: string | null;
  created_at: string;
};

/** Scores a goal can be given — mirrors the `goals_score_check` constraint. */
export const VALID_SCORES = [0, 1, 3, 5] as const;

/** Repeat cadences the client offers. `None` is the column default. */
export const REPEAT_OPTIONS = ['None', 'Daily', 'Weekly', 'Monthly', 'Yearly'] as const;

export type RepeatOption = (typeof REPEAT_OPTIONS)[number];

export function isRepeatOption(value: unknown): value is RepeatOption {
  return typeof value === 'string' && (REPEAT_OPTIONS as readonly string[]).includes(value);
}

export function expiresAt(goal: Pick<GoalRow, 'start_at' | 'duration_min'>): Date {
  return new Date(new Date(goal.start_at).getTime() + goal.duration_min * 60_000);
}

export function hasStarted(goal: Pick<GoalRow, 'start_at'>, now = new Date()): boolean {
  return now >= new Date(goal.start_at);
}

export function hasExpired(
  goal: Pick<GoalRow, 'start_at' | 'duration_min'>,
  now = new Date(),
): boolean {
  return now >= expiresAt(goal);
}

/** The shape every goal-returning route responds with. */
export function serializeGoal(goal: GoalRow, now = new Date()) {
  return {
    id: goal.id,
    userId: goal.user_id,
    category: goal.category,
    sub: goal.sub,
    title: goal.title,
    startAt: new Date(goal.start_at).toISOString(),
    durationMin: goal.duration_min,
    expiresAt: expiresAt(goal).toISOString(),
    alertMin: goal.alert_min,
    repeat: goal.repeat,
    phone: goal.phone,
    address: goal.address,
    notes: goal.notes,
    score: goal.score,
    scoreNotes: goal.score_notes,
    createdAt: new Date(goal.created_at).toISOString(),
    started: hasStarted(goal, now),
    expired: hasExpired(goal, now),
    scorable: hasExpired(goal, now) && goal.score === null,
    editable: !hasStarted(goal, now),
  };
}
