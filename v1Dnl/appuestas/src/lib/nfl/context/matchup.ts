import type { NflMetricStatus, NflMetricValue, NflQuarterbackProfile, NflStatisticWindow, NflTeamProfile } from "../statistics/types";
import type { NflMetricComparison, NflObservedQuarterback, NflTeamMatchup } from "./types";

function metric(args: {
  value: number | null;
  unit: string;
  status: NflMetricStatus;
  window: NflStatisticWindow;
  denominator?: number | null;
  snapshotId: string;
  sourceFields: string[];
}): NflMetricValue {
  return {
    value: args.value,
    unit: args.unit,
    status: args.status,
    window: args.window,
    denominator: args.denominator ?? null,
    snapshotId: args.snapshotId,
    sourceFields: args.sourceFields,
  };
}

function comparison(offense: NflMetricValue, opponentDefense: NflMetricValue, unit = offense.unit): NflMetricComparison {
  const status = offense.status === "unavailable" || opponentDefense.status === "unavailable"
    ? "unavailable"
    : offense.status === "available" && opponentDefense.status === "available"
      ? "available"
      : "insufficient_data";
  const window = offense.window;
  const sourceFields = [...new Set([...offense.sourceFields, ...opponentDefense.sourceFields])];
  return {
    offense,
    opponentDefense,
    difference: metric({
      value: status === "available" && offense.value !== null && opponentDefense.value !== null
        ? offense.value - opponentDefense.value
        : null,
      unit: `${unit} differential (offense - allowed)`,
      status,
      window,
      snapshotId: offense.snapshotId,
      sourceFields,
    }),
  };
}

function allowedCompletionRate(profile: NflTeamProfile, kind: "seasonBaseline" | "recentForm"): NflMetricValue {
  const template = profile[kind].completion_rate;
  const gameIds = template.window.gameIds;
  const rows = profile.cutoff.opponentStats.filter((row) => gameIds.includes(row.game_id));
  const minGames = kind === "recentForm" ? 3 : 1;
  const sourceFields = ["cutoff.opponentStats.completions", "cutoff.opponentStats.attempts"];
  const window = template.window;
  if (gameIds.length < minGames || rows.length !== gameIds.length) {
    return metric({ value: null, unit: "opponent completions/attempt", status: "insufficient_data", window, snapshotId: profile.snapshotId, sourceFields });
  }
  const completions = rows.map((row) => row.completions);
  const attempts = rows.map((row) => row.attempts);
  if (completions.some((value) => typeof value !== "number") || attempts.some((value) => typeof value !== "number")) {
    return metric({ value: null, unit: "opponent completions/attempt", status: "insufficient_data", window, snapshotId: profile.snapshotId, sourceFields });
  }
  const totalCompletions = (completions as number[]).reduce((sum, value) => sum + value, 0);
  const totalAttempts = (attempts as number[]).reduce((sum, value) => sum + value, 0);
  if (totalAttempts <= 0) return metric({ value: null, unit: "opponent completions/attempt", status: "insufficient_data", window, denominator: totalAttempts, snapshotId: profile.snapshotId, sourceFields });
  return metric({ value: totalCompletions / totalAttempts, unit: "opponent completions/attempt", status: "available", window, denominator: totalAttempts, snapshotId: profile.snapshotId, sourceFields });
}

function allowedEpaPerGame(profile: NflTeamProfile, kind: "seasonBaseline" | "recentForm", field: "passing_epa" | "rushing_epa"): NflMetricValue {
  const template = profile[kind][field === "passing_epa" ? "passing_epa_per_game" : "rushing_epa_per_game"];
  const gameIds = template.window.gameIds;
  const rows = profile.cutoff.opponentStats.filter((row) => gameIds.includes(row.game_id));
  const minimumGames = kind === "recentForm" ? 3 : 1;
  const sourceFields = [`cutoff.opponentStats.${field}`];
  if (gameIds.length < minimumGames || rows.length !== gameIds.length) {
    return metric({ value: null, unit: "opponent EPA/game", status: "insufficient_data", window: template.window, snapshotId: profile.snapshotId, sourceFields });
  }
  const values = rows.map((row) => row[field]);
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    return metric({ value: null, unit: "opponent EPA/game", status: "insufficient_data", window: template.window, snapshotId: profile.snapshotId, sourceFields });
  }
  return metric({
    value: (values as number[]).reduce((sum, value) => sum + value, 0) / gameIds.length,
    unit: "opponent EPA/game",
    status: "available",
    window: template.window,
    denominator: gameIds.length,
    snapshotId: profile.snapshotId,
    sourceFields,
  });
}

function weightedAllowedEpaPerGame(profile: NflTeamProfile, field: "passing_epa" | "rushing_epa"): NflMetricValue {
  const season = allowedEpaPerGame(profile, "seasonBaseline", field);
  const recent = allowedEpaPerGame(profile, "recentForm", field);
  const status = season.status === "available" && recent.status === "available" ? "available" : "insufficient_data";
  return metric({
    value: status === "available" && season.value !== null && recent.value !== null
      ? season.value * 0.6 + recent.value * 0.4
      : null,
    unit: "opponent EPA/game (60/40)",
    status,
    window: profile.weighted.passing_epa_per_game.window,
    snapshotId: profile.snapshotId,
    sourceFields: [...new Set([...season.sourceFields, ...recent.sourceFields])],
  });
}

function weightedAllowedCompletionRate(profile: NflTeamProfile): NflMetricValue {
  const season = allowedCompletionRate(profile, "seasonBaseline");
  const recent = allowedCompletionRate(profile, "recentForm");
  const sourceFields = [...new Set([...season.sourceFields, ...recent.sourceFields])];
  const status = season.status === "available" && recent.status === "available" ? "available" : "insufficient_data";
  return metric({
    value: status === "available" && season.value !== null && recent.value !== null
      ? season.value * 0.6 + recent.value * 0.4
      : null,
    unit: "opponent completions/attempt (60/40)",
    status,
    window: profile.weighted.completion_rate.window,
    snapshotId: profile.snapshotId,
    sourceFields,
  });
}

function derivedRate(
  qb: NflQuarterbackProfile,
  period: "seasonBaseline" | "recentForm",
  numeratorName: "passing_tds" | "passing_interceptions",
  label: string,
): NflMetricValue {
  const numerator = qb[period][numeratorName];
  const attempts = qb[period].attempts;
  const window = numerator.window;
  const sourceFields = [...new Set([...numerator.sourceFields, ...attempts.sourceFields])];
  if (numerator.status !== "available" || attempts.status !== "available" || numerator.value === null || attempts.value === null || attempts.value <= 0) {
    return metric({ value: null, unit: `${label}/attempt`, status: "insufficient_data", window, snapshotId: numerator.snapshotId, sourceFields });
  }
  return metric({ value: numerator.value / attempts.value, unit: `${label}/attempt`, status: "available", window, denominator: attempts.value, snapshotId: numerator.snapshotId, sourceFields });
}

function weightedDerivedRate(
  qb: NflQuarterbackProfile,
  numeratorName: "passing_tds" | "passing_interceptions",
  label: string,
): NflMetricValue {
  const season = derivedRate(qb, "seasonBaseline", numeratorName, label);
  const recent = derivedRate(qb, "recentForm", numeratorName, label);
  const status = season.status === "available" && recent.status === "available" ? "available" : "insufficient_data";
  return metric({
    value: status === "available" && season.value !== null && recent.value !== null
      ? season.value * 0.6 + recent.value * 0.4
      : null,
    unit: `${label}/attempt (60/40)`,
    status,
    window: qb.weighted.attempts.window,
    snapshotId: qb.weighted.attempts.snapshotId,
    sourceFields: [...new Set([...season.sourceFields, ...recent.sourceFields])],
  });
}

function observedQuarterback(qb: NflQuarterbackProfile): NflObservedQuarterback {
  return {
    playerId: qb.playerId,
    displayName: qb.displayName,
    position: qb.position,
    seasonBaseline: qb.seasonBaseline,
    recentForm: qb.recentForm,
    weighted: qb.weighted,
    derivedRates: {
      seasonPassingTdRate: derivedRate(qb, "seasonBaseline", "passing_tds", "passing TD"),
      recentPassingTdRate: derivedRate(qb, "recentForm", "passing_tds", "passing TD"),
      weightedPassingTdRate: weightedDerivedRate(qb, "passing_tds", "passing TD"),
      seasonInterceptionRate: derivedRate(qb, "seasonBaseline", "passing_interceptions", "interception"),
      recentInterceptionRate: derivedRate(qb, "recentForm", "passing_interceptions", "interception"),
      weightedInterceptionRate: weightedDerivedRate(qb, "passing_interceptions", "interception"),
    },
  };
}

function teamMatchup(offense: NflTeamProfile, defense: NflTeamProfile, side: "HOME" | "AWAY"): NflTeamMatchup {
  return {
    team: offense.team,
    side,
    pass: {
      passingEpaPerGame: comparison(offense.weighted.passing_epa_per_game, weightedAllowedEpaPerGame(defense, "passing_epa"), "EPA/game"),
      yardsPerAttempt: comparison(offense.weighted.passing_yards_per_attempt, defense.weighted.passing_yards_allowed_per_attempt, "yards/attempt"),
      completionRate: comparison(offense.weighted.completion_rate, weightedAllowedCompletionRate(defense), "completions/attempt"),
    },
    rush: {
      rushingEpaPerGame: comparison(offense.weighted.rushing_epa_per_game, weightedAllowedEpaPerGame(defense, "rushing_epa"), "EPA/game"),
      yardsPerCarry: comparison(offense.weighted.rushing_yards_per_carry, defense.weighted.rushing_yards_allowed_per_carry, "yards/carry"),
    },
    qb: {
      starting_qb_status: "unavailable",
      observedCandidates: offense.quarterbacks.map(observedQuarterback),
    },
  };
}

export function buildNflMatchup(homeProfile: NflTeamProfile, awayProfile: NflTeamProfile) {
  return {
    home: teamMatchup(homeProfile, awayProfile, "HOME"),
    away: teamMatchup(awayProfile, homeProfile, "AWAY"),
  };
}
