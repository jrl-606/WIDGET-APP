/**
 * Rank ladder and life areas.
 *
 * NOTE: the WIDGET client keeps the same ladder in `RANKS` / `rankFor()` in
 * `widget-beta.jsx`. That file is not part of this repo, so the thresholds
 * below are the API's source of truth until the two are reconciled — if the
 * app's ladder differs, copy it here verbatim and update both from then on.
 *
 * Points come straight from goal scores: a scored goal is worth 0, 1, 3, or 5
 * points in its category (the `goals_score_check` constraint in Postgres).
 */

export const CATEGORIES = [
  'Personal Life',
  'Business',
  'Finances',
  'Education',
  'Mental Health',
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

/** Ascending by `min`; the last entry whose `min` is met wins. */
export const RANKS = [
  { name: 'Novice', min: 0 },
  { name: 'Apprentice', min: 10 },
  { name: 'Adept', min: 25 },
  { name: 'Expert', min: 50 },
  { name: 'Master', min: 100 },
  { name: 'Grandmaster', min: 200 },
] as const;

export type Rank = (typeof RANKS)[number]['name'];

export function rankFor(points: number): Rank {
  let rank: Rank = RANKS[0].name;
  for (const entry of RANKS) {
    if (points >= entry.min) rank = entry.name;
  }
  return rank;
}

/** Points still needed for the next rank, or null at the top of the ladder. */
export function pointsToNextRank(points: number): number | null {
  const next = RANKS.find((entry) => points < entry.min);
  return next ? next.min - points : null;
}

export type CategoryStanding = {
  category: Category;
  points: number;
  rank: Rank;
  pointsToNextRank: number | null;
};

export function standingsFrom(pointsByCategory: Map<string, number>): CategoryStanding[] {
  return CATEGORIES.map((category) => {
    const points = pointsByCategory.get(category) ?? 0;
    return {
      category,
      points,
      rank: rankFor(points),
      pointsToNextRank: pointsToNextRank(points),
    };
  });
}
