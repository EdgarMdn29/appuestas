import type { NflScheduleGame } from "../statistics/types";
import type { NflContextBuildContext, NflContextMetric, NflGameContext, NflTeamBye } from "./types";

function numeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function category(value: unknown, field: string, snapshotId: string): NflContextMetric<string> {
  const available = typeof value === "string" && value.trim().length > 0;
  return {
    value: available ? (value as string).trim() : null,
    status: available ? "available" : "unavailable",
    sourceFields: [`schedule.${field}`],
    snapshotId,
  };
}

function numericContext(value: unknown, field: string, snapshotId: string): NflContextMetric<number> {
  const available = numeric(value);
  return {
    value: available ? value : null,
    status: available ? "available" : "unavailable",
    sourceFields: [`schedule.${field}`],
    snapshotId,
  };
}

function byeForTeam(context: NflContextBuildContext, team: string): NflTeamBye {
  const schedule = context.snapshot.data.schedule.rows as NflScheduleGame[];
  const teamGames = [...new Map(schedule.filter((game) => game.season === context.snapshot.season && game.game_type === "REG"
    && (game.home_team === team || game.away_team === team)).map((game) => [game.game_id, game])).values()];
  if (context.targetGame.game_type !== "REG") {
    return { byeWeek: null, byeBeforeTarget: null, status: "postseason", scheduledRegularSeasonGames: teamGames.length };
  }
  if (teamGames.length < 17) {
    return { byeWeek: null, byeBeforeTarget: null, status: "insufficient_data", scheduledRegularSeasonGames: teamGames.length };
  }
  if (teamGames.length !== 17) {
    return { byeWeek: null, byeBeforeTarget: null, status: "ambiguous", scheduledRegularSeasonGames: teamGames.length };
  }

  const weeks = teamGames.map((game) => game.week);
  if (weeks.some((week) => !Number.isInteger(week) || week < 1 || week > 18)) {
    return { byeWeek: null, byeBeforeTarget: null, status: "ambiguous", scheduledRegularSeasonGames: teamGames.length };
  }
  const uniqueWeeks = new Set(weeks);
  const missingWeeks = Array.from({ length: 18 }, (_, index) => index + 1).filter((week) => !uniqueWeeks.has(week));
  if (uniqueWeeks.size !== 17 || missingWeeks.length !== 1) {
    return { byeWeek: null, byeBeforeTarget: null, status: "ambiguous", scheduledRegularSeasonGames: teamGames.length };
  }

  const byeWeek = missingWeeks[0];
  return {
    byeWeek,
    byeBeforeTarget: byeWeek < context.targetGame.week,
    status: "inferred",
    scheduledRegularSeasonGames: teamGames.length,
  };
}

export function buildNflContextFields(context: NflContextBuildContext): Pick<NflGameContext, "context" | "availability"> {
  const { snapshot, targetGame } = context;
  const homeRest = numericContext(targetGame.home_rest, "home_rest", snapshot.id);
  const awayRest = numericContext(targetGame.away_rest, "away_rest", snapshot.id);
  const restAvailable = homeRest.value !== null && awayRest.value !== null;
  const restAdvantage: NflContextMetric<number> = {
    value: restAvailable ? homeRest.value! - awayRest.value! : null,
    status: restAvailable ? "available" : "unavailable",
    sourceFields: ["schedule.home_rest", "schedule.away_rest"],
    snapshotId: snapshot.id,
  };

  const neutral = targetGame.location === "Neutral";
  const knownLocation = neutral || targetGame.location === "Home";
  const location = {
    home: {
      value: knownLocation ? (neutral ? "NEUTRAL" as const : "HOME" as const) : null,
      status: knownLocation ? "available" as const : "unavailable" as const,
      sourceFields: ["schedule.location", "schedule.home_team"],
      snapshotId: snapshot.id,
    },
    away: {
      value: knownLocation ? (neutral ? "NEUTRAL" as const : "AWAY" as const) : null,
      status: knownLocation ? "available" as const : "unavailable" as const,
      sourceFields: ["schedule.location", "schedule.away_team"],
      snapshotId: snapshot.id,
    },
  };

  return {
    context: {
      location,
      rest: { homeRest, awayRest, rest_advantage: restAdvantage },
      bye: {
        home: byeForTeam(context, context.homeProfile.team),
        away: byeForTeam(context, context.awayProfile.team),
      },
      travel: { status: "unavailable", reason: "The selected snapshot has no team origin coordinates or time-zone catalog." },
      venue: {
        stadium: category(targetGame.stadium, "stadium", snapshot.id),
        surface: category(targetGame.surface, "surface", snapshot.id),
        roof: category(targetGame.roof, "roof", snapshot.id),
      },
      weather: { status: "unavailable", reason: "Observed temperature and wind are excluded from the pregame profile; no forecast source is captured." },
    },
    availability: {
      injuries: "unavailable",
      startingQb: "unavailable",
    },
  };
}
