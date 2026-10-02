import { getNflScheduleKickoffUtc } from "../statistics/cutoff";
import type { NflScheduleGame } from "../statistics/types";
import type { NflContextBuildContext, NflContextMetric, NflTeamDivisionHistory } from "./types";

function numeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCompleted(game: NflScheduleGame): boolean {
  return numeric(game.home_score) && numeric(game.away_score);
}

function isDivisional(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return null;
}

function divisionalHistory(context: NflContextBuildContext, team: string): NflTeamDivisionHistory {
  const schedule = context.snapshot.data.schedule.rows as NflScheduleGame[];
  const targetTime = Date.parse(context.targetKickoff);
  const games = schedule.flatMap((game) => {
    if (game.season !== context.snapshot.season || isDivisional(game.div_game) !== true || !isCompleted(game)) return [];
    if (game.home_team !== team && game.away_team !== team) return [];
    const kickoff = getNflScheduleKickoffUtc(game);
    if (!kickoff || Date.parse(kickoff) >= targetTime || game.game_id === context.targetGame.game_id) return [];
    const margin = game.home_team === team
      ? (game.home_score as number) - (game.away_score as number)
      : (game.away_score as number) - (game.home_score as number);
    return [{ game, kickoff, margin }];
  }).sort((left, right) => left.kickoff.localeCompare(right.kickoff) || left.game.game_id.localeCompare(right.game.game_id));

  const selected = games.slice(-3);
  const wins = selected.filter(({ margin }) => margin > 0).length;
  const losses = selected.filter(({ margin }) => margin < 0).length;
  const ties = selected.length - wins - losses;
  return {
    wins,
    losses,
    ties,
    averageMargin: selected.length ? selected.reduce((sum, item) => sum + item.margin, 0) / selected.length : null,
    gamesConsidered: selected.length,
    status: selected.length === 3 ? "available" : "insufficient_data",
    gameIds: selected.map(({ game }) => game.game_id),
  };
}

export function buildNflDivisionContext(context: NflContextBuildContext) {
  const targetDivisional = isDivisional(context.targetGame.div_game);
  const isDivisionalMetric: NflContextMetric<boolean> = {
    value: targetDivisional,
    status: targetDivisional === null ? "unavailable" : "available",
    sourceFields: ["schedule.div_game"],
    snapshotId: context.snapshot.id,
  };
  return {
    isDivisional: isDivisionalMetric,
    homeHistory: divisionalHistory(context, context.homeProfile.team),
    awayHistory: divisionalHistory(context, context.awayProfile.team),
  };
}
