import { sql } from './db';
import { standingsFrom, type CategoryStanding } from './ranks';

type StatRow = {
  category: string;
  points: string | number;
  total_goals: string | number;
  scored_goals: string | number;
};

export type PublicStats = {
  userId: string;
  displayName: string;
  totalPoints: number;
  areas: CategoryStanding[];
};

export type PrivateStats = PublicStats & {
  areas: (CategoryStanding & { totalGoals: number; scoredGoals: number; unscoredGoals: number })[];
  totalGoals: number;
  scoredGoals: number;
};

const num = (value: string | number) => (typeof value === 'number' ? value : Number(value));

async function statRows(userId: string): Promise<StatRow[]> {
  return (await sql`
    select
      category,
      coalesce(sum(score), 0) as points,
      count(*) as total_goals,
      count(score) as scored_goals
    from goals
    where user_id = ${userId}
    group by category
  `) as StatRow[];
}

/** Rank + points per life area. Deliberately carries no goal counts. */
export async function publicStats(userId: string, displayName: string): Promise<PublicStats> {
  const rows = await statRows(userId);
  const points = new Map(rows.map((row) => [row.category, num(row.points)]));
  const areas = standingsFrom(points);

  return {
    userId,
    displayName,
    totalPoints: areas.reduce((sum, area) => sum + area.points, 0),
    areas,
  };
}

/** Everything in `publicStats` plus per-area goal counts — owner only. */
export async function privateStats(userId: string, displayName: string): Promise<PrivateStats> {
  const rows = await statRows(userId);
  const byCategory = new Map(rows.map((row) => [row.category, row]));
  const points = new Map(rows.map((row) => [row.category, num(row.points)]));

  const areas = standingsFrom(points).map((area) => {
    const row = byCategory.get(area.category);
    const totalGoals = row ? num(row.total_goals) : 0;
    const scoredGoals = row ? num(row.scored_goals) : 0;
    return { ...area, totalGoals, scoredGoals, unscoredGoals: totalGoals - scoredGoals };
  });

  return {
    userId,
    displayName,
    totalPoints: areas.reduce((sum, area) => sum + area.points, 0),
    areas,
    totalGoals: areas.reduce((sum, area) => sum + area.totalGoals, 0),
    scoredGoals: areas.reduce((sum, area) => sum + area.scoredGoals, 0),
  };
}
