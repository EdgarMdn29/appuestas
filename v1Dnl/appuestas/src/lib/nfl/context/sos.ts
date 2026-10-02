import { getNflScheduleKickoffUtc } from "../statistics/cutoff";
import type { NflScheduleGame } from "../statistics/types";
import type { NflContextBuildContext, NflSosSide } from "./types";
import type { NflMetricStatus, NflMetricValue } from "../statistics/types";

function score(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function completed(game: NflScheduleGame): boolean {
  return score(game.home_score) && score(game.away_score);
}

function teamOpponent(game: NflScheduleGame, team: string): string | null {
  if (game.home_team === team) return game.away_team;
  if (game.away_team === team) return game.home_team;
  return null;
}

function gameTypeAllowed(game: NflScheduleGame, target: NflScheduleGame): boolean {
  return target.game_type === "REG" ? game.game_type === "REG" : game.game_type !== undefined;
}

function teamSos(context: NflContextBuildContext, team: string): NflSosSide {
  const { snapshot, targetGame, targetKickoff } = context;
  const targetTime = Date.parse(targetKickoff);
  const schedule = snapshot.data.schedule.rows as NflScheduleGame[];
  const priorCompletedGames = schedule.filter((game) => {
    const kickoff = getNflScheduleKickoffUtc(game);
    return game.season === snapshot.season && game.game_id !== targetGame.game_id && gameTypeAllowed(game, targetGame)
      && kickoff !== null && Date.parse(kickoff) < targetTime && completed(game);
  });
  const teamGames = priorCompletedGames.filter((game) => teamOpponent(game, team) !== null)
    .sort((left, right) => getNflScheduleKickoffUtc(left)!.localeCompare(getNflScheduleKickoffUtc(right)!));

  const records = teamGames.map((game) => {
    const opponent = teamOpponent(game, team)!;
    const opponentGames = priorCompletedGames.filter((candidate) => teamOpponent(candidate, opponent) !== null);
    if (!opponentGames.length) return { gameId: game.game_id, opponent, winPct: null, completedGames: 0 };

    let wins = 0;
    let ties = 0;
    for (const opponentGame of opponentGames) {
      const homeWon = (opponentGame.home_score as number) > (opponentGame.away_score as number);
      const awayWon = (opponentGame.away_score as number) > (opponentGame.home_score as number);
      if (opponentGame.home_score === opponentGame.away_score) ties += 1;
      else if ((homeWon && opponentGame.home_team === opponent) || (awayWon && opponentGame.away_team === opponent)) wins += 1;
    }
    return { gameId: game.game_id, opponent, winPct: (wins + 0.5 * ties) / opponentGames.length, completedGames: opponentGames.length };
  });

  const ratedOpponentGames = records.filter((record) => record.winPct !== null).length;
  const allOpponentsRated = records.length > 0 && ratedOpponentGames === records.length;
  const value = allOpponentsRated
    ? records.reduce((sum, record) => sum + (record.winPct ?? 0), 0) / records.length
    : null;
  const status: NflMetricStatus = allOpponentsRated ? "available" : "insufficient_data";
  const distinctOpponents = new Set(records.map((record) => record.opponent)).size;
  return {
    value,
    gamesConsidered: teamGames.length,
    opponentsConsidered: distinctOpponents,
    ratedOpponentGames,
    status,
    window: {
      season: snapshot.season,
      gameType: targetGame.game_type === "REG" ? "REG" : "POST",
      cutoff: targetKickoff,
      gameIds: teamGames.map((game) => game.game_id),
    },
    opponentRecords: records,
  };
}

function differential(home: NflSosSide, away: NflSosSide, snapshotId: string): NflMetricValue {
  const status: NflMetricStatus = home.status === "available" && away.status === "available" ? "available" : "insufficient_data";
  const sharedIds = [...new Set([...home.window.gameIds, ...away.window.gameIds])];
  return {
    value: status === "available" && home.value !== null && away.value !== null ? home.value - away.value : null,
    unit: "opponent win percentage (home - away)",
    status,
    window: {
      kind: "season_to_date",
      gameCount: sharedIds.length,
      gameIds: sharedIds,
      fromKickoff: null,
      throughKickoff: null,
    },
    denominator: null,
    snapshotId,
    sourceFields: ["schedule.home_score", "schedule.away_score", "schedule.home_team", "schedule.away_team"],
  };
}

export function buildNflStrengthOfSchedule(context: NflContextBuildContext) {
  const home = teamSos(context, context.homeProfile.team);
  const away = teamSos(context, context.awayProfile.team);
  return { home, away, differential: differential(home, away, context.snapshot.id) };
}
