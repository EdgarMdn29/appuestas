import type {
  NflCutoffResult,
  NflGameObservation,
  NflMetricValue,
  NflMetricStatus,
  NflPlayerStatRow,
  NflQuarterbackProfile,
  NflStatisticWindow,
  NflTeamStatRow,
  NflTeamWindowMetrics,
} from "./types";

const EXPLOSIVE_FIELDS = [
  "passing_20", "passing_40", "rushing_10", "rushing_12", "rushing_20", "rushing_40", "receiving_20", "receiving_40",
] as const;
const SPECIAL_TEAMS_FIELDS = [
  "fg_att", "fg_made", "fg_missed", "fg_blocked", "pat_att", "pat_made", "pat_missed", "pat_blocked",
  "pt_att", "pt_yards", "pt_net_yards", "pt_inside_20", "pt_blocked", "pt_returned", "pt_return_yards",
  "kickoff_returns", "kickoff_return_yards", "punt_returns", "punt_return_yards", "special_teams_tds",
] as const;
const SPECIAL_TEAMS_RATIOS = [
  "field_goal_percentage", "extra_point_percentage", "gross_punt_yards_per_punt", "net_punt_yards_per_punt",
  "kickoff_return_yards_per_return", "punt_return_yards_per_return",
] as const;
const SUM_METRICS = new Set([
  "passing_epa", "rushing_epa", "offensive_epa", "passing_epa_allowed", "rushing_epa_allowed", "defensive_epa_allowed",
  "turnovers", "interceptions", "fumbles_lost", "defensive_interceptions", "fumble_recoveries", "sacks", "sacks_allowed",
]);

function fieldValue(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function makeWindow(cutoff: NflCutoffResult, kind: NflStatisticWindow["kind"], observations: NflGameObservation[]): NflStatisticWindow {
  return {
    kind,
    gameCount: observations.length,
    gameIds: observations.map(({ game }) => game.game_id),
    fromKickoff: observations[0]?.kickoff ?? null,
    throughKickoff: observations.at(-1)?.kickoff ?? null,
  };
}

function metric(args: {
  value: number | null;
  unit: string;
  status?: NflMetricStatus;
  window: NflStatisticWindow;
  denominator?: number | null;
  snapshotId: string;
  sourceFields: string[];
}): NflMetricValue {
  return {
    value: args.value,
    unit: args.unit,
    status: args.status ?? (args.value === null ? "insufficient_data" : "available"),
    window: args.window,
    denominator: args.denominator ?? null,
    snapshotId: args.snapshotId,
    sourceFields: args.sourceFields,
  };
}

function sumField(args: {
  rows: Record<string, unknown>[];
  field: string;
  unit: string;
  window: NflStatisticWindow;
  snapshotId: string;
  minimumGames?: number;
}): NflMetricValue {
  const { rows, field, unit, window, snapshotId } = args;
  if (rows.length < (args.minimumGames ?? 1)) {
    return metric({ value: null, unit, status: "insufficient_data", window, snapshotId, sourceFields: [field] });
  }
  const values = rows.map((row) => fieldValue(row, field));
  if (values.some((value) => value === null)) {
    return metric({ value: null, unit, status: "insufficient_data", window, snapshotId, sourceFields: [field] });
  }
  return metric({ value: values.reduce<number>((total, value) => total + (value ?? 0), 0), unit, window, snapshotId, sourceFields: [field] });
}

function ratio(args: {
  rows: Record<string, unknown>[];
  numerator: string;
  denominator: string;
  unit: string;
  window: NflStatisticWindow;
  snapshotId: string;
  minimumGames?: number;
}): NflMetricValue {
  const { rows, numerator, denominator, unit, window, snapshotId } = args;
  if (rows.length < (args.minimumGames ?? 1)) {
    return metric({ value: null, unit, status: "insufficient_data", window, snapshotId, sourceFields: [numerator, denominator] });
  }
  const values = rows.map((row) => [fieldValue(row, numerator), fieldValue(row, denominator)] as const);
  if (values.some(([n, d]) => n === null || d === null)) {
    return metric({ value: null, unit, status: "insufficient_data", window, snapshotId, sourceFields: [numerator, denominator] });
  }
  const totalNumerator = values.reduce((sum, [value]) => sum + (value ?? 0), 0);
  const totalDenominator = values.reduce((sum, [, value]) => sum + (value ?? 0), 0);
  if (totalDenominator <= 0) {
    return metric({ value: null, unit, status: "insufficient_data", window, denominator: totalDenominator, snapshotId, sourceFields: [numerator, denominator] });
  }
  return metric({ value: totalNumerator / totalDenominator, unit, window, denominator: totalDenominator, snapshotId, sourceFields: [numerator, denominator] });
}

function perGame(args: {
  rows: Record<string, unknown>[];
  field: string;
  unit: string;
  window: NflStatisticWindow;
  snapshotId: string;
  minimumGames?: number;
}): NflMetricValue {
  const total = sumField(args);
  if (args.rows.length < (args.minimumGames ?? 1) || total.value === null || !windowCount(args.window)) {
    return { ...total, value: null, status: "insufficient_data", unit: args.unit, denominator: args.window.gameCount };
  }
  return { ...total, value: total.value / args.window.gameCount, unit: args.unit, denominator: args.window.gameCount };
}

function windowCount(window: NflStatisticWindow): boolean {
  return window.gameCount > 0;
}

function opponentRows(cutoff: NflCutoffResult, observations: NflGameObservation[]): NflTeamStatRow[] {
  const gameIds = new Set(observations.map(({ game }) => game.game_id));
  return cutoff.opponentStats.filter((row) => gameIds.has(row.game_id));
}

function opponentObservations(observations: NflGameObservation[], opponentStats: NflTeamStatRow[]): NflGameObservation[] {
  const rowsByGame = new Map(opponentStats.map((row) => [row.game_id, row]));
  return observations.filter(({ game }) => rowsByGame.has(game.game_id));
}

function addMetrics(
  base: NflTeamWindowMetrics,
  cutoff: NflCutoffResult,
  observations: NflGameObservation[],
  kind: NflStatisticWindow["kind"],
  minimumGames: number,
): NflTeamWindowMetrics {
  const window = makeWindow(cutoff, kind, observations);
  const rows = observations.map(({ teamStat }) => teamStat);
  const opponent = opponentRows(cutoff, observations);
  const opponentWindow = makeWindow(cutoff, kind, opponentObservations(observations, opponent));
  const minimum = minimumGames;

  const passingEpa = sumField({ rows, field: "passing_epa", unit: "EPA (nflverse window total)", window, snapshotId: cutoff.snapshotId, minimumGames: minimum });
  const rushingEpa = sumField({ rows, field: "rushing_epa", unit: "EPA (nflverse window total)", window, snapshotId: cutoff.snapshotId, minimumGames: minimum });
  const passingAllowed = sumField({ rows: opponent, field: "passing_epa", unit: "opponent EPA (nflverse window total)", window: opponentWindow, snapshotId: cutoff.snapshotId, minimumGames: minimum });
  const rushingAllowed = sumField({ rows: opponent, field: "rushing_epa", unit: "opponent EPA (nflverse window total)", window: opponentWindow, snapshotId: cutoff.snapshotId, minimumGames: minimum });
  const defensiveEpa = (passingAllowed.value === null || rushingAllowed.value === null)
    ? metric({ value: null, unit: "opponent EPA (nflverse window total)", status: "insufficient_data", window: opponentWindow, snapshotId: cutoff.snapshotId, sourceFields: ["opponent.passing_epa", "opponent.rushing_epa"] })
    : metric({ value: passingAllowed.value + rushingAllowed.value, unit: "opponent EPA (nflverse window total)", window: opponentWindow, snapshotId: cutoff.snapshotId, sourceFields: ["opponent.passing_epa", "opponent.rushing_epa"] });

  const interceptions = sumField({ rows, field: "passing_interceptions", unit: "interceptions", window, snapshotId: cutoff.snapshotId, minimumGames: minimum });
  const fumblesLost = sumField({ rows, field: "fumbles_lost_total", unit: "fumbles lost", window, snapshotId: cutoff.snapshotId, minimumGames: minimum });
  const turnovers = interceptions.value === null || fumblesLost.value === null
    ? metric({ value: null, unit: "giveaways (count)", status: "insufficient_data", window, snapshotId: cutoff.snapshotId, sourceFields: ["passing_interceptions", "fumbles_lost_total"] })
    : metric({ value: interceptions.value + fumblesLost.value, unit: "giveaways (count)", window, snapshotId: cutoff.snapshotId, sourceFields: ["passing_interceptions", "fumbles_lost_total"] });

  const explosiveComponents = Object.fromEntries(EXPLOSIVE_FIELDS.map((field) => [field, sumField({ rows, field, unit: "plays (nflverse count)", window, snapshotId: cutoff.snapshotId, minimumGames: minimum })]));
  const specialTeams = Object.fromEntries(SPECIAL_TEAMS_FIELDS.map((field) => [field, sumField({ rows, field, unit: "nflverse count/yards", window, snapshotId: cutoff.snapshotId, minimumGames: minimum })]));
  Object.assign(specialTeams, {
    field_goal_percentage: ratio({ rows, numerator: "fg_made", denominator: "fg_att", unit: "made/attempt", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    extra_point_percentage: ratio({ rows, numerator: "pat_made", denominator: "pat_att", unit: "made/attempt", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    gross_punt_yards_per_punt: ratio({ rows, numerator: "pt_yards", denominator: "pt_att", unit: "gross punt yards/punt", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    net_punt_yards_per_punt: ratio({ rows, numerator: "pt_net_yards", denominator: "pt_att", unit: "net punt yards/punt", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    kickoff_return_yards_per_return: ratio({ rows, numerator: "kickoff_return_yards", denominator: "kickoff_returns", unit: "kickoff return yards/return", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    punt_return_yards_per_return: ratio({ rows, numerator: "punt_return_yards", denominator: "punt_returns", unit: "punt return yards/return", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
  });
  const defensiveInterceptions = sumField({ rows, field: "def_interceptions", unit: "defensive interceptions", window, snapshotId: cutoff.snapshotId, minimumGames: minimum });
  const fumbleRecoveries = sumField({ rows, field: "fumble_recovery_opp", unit: "opponent fumbles recovered", window, snapshotId: cutoff.snapshotId, minimumGames: minimum });
  const sacks = sumField({ rows, field: "def_sacks", unit: "sacks", window, snapshotId: cutoff.snapshotId, minimumGames: minimum });
  const sacksAllowed = sumField({ rows, field: "sacks_suffered", unit: "sacks", window, snapshotId: cutoff.snapshotId, minimumGames: minimum });

  return {
    ...base,
    passing_epa: passingEpa,
    rushing_epa: rushingEpa,
    offensive_epa: passingEpa.value === null || rushingEpa.value === null
      ? metric({ value: null, unit: "EPA (nflverse window total)", status: "insufficient_data", window, snapshotId: cutoff.snapshotId, sourceFields: ["passing_epa", "rushing_epa"] })
      : metric({ value: passingEpa.value + rushingEpa.value, unit: "EPA (nflverse window total)", window, snapshotId: cutoff.snapshotId, sourceFields: ["passing_epa", "rushing_epa"] }),
    passing_epa_allowed: passingAllowed,
    rushing_epa_allowed: rushingAllowed,
    defensive_epa_allowed: defensiveEpa,
    passing_epa_per_game: perGame({ rows, field: "passing_epa", unit: "EPA/game (derived; no per-play denominator)", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    rushing_epa_per_game: perGame({ rows, field: "rushing_epa", unit: "EPA/game (derived; no per-play denominator)", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    offensive_epa_per_game: passingEpa.value === null || rushingEpa.value === null || !window.gameCount
      ? metric({ value: null, unit: "EPA/game (derived; no per-play denominator)", status: "insufficient_data", window, snapshotId: cutoff.snapshotId, sourceFields: ["passing_epa", "rushing_epa"] })
      : metric({ value: (passingEpa.value! + rushingEpa.value!) / window.gameCount, unit: "EPA/game (derived; no per-play denominator)", window, denominator: window.gameCount, snapshotId: cutoff.snapshotId, sourceFields: ["passing_epa", "rushing_epa"] }),
    defensive_epa_allowed_per_game: defensiveEpa.value === null || !opponentWindow.gameCount
      ? metric({ value: null, unit: "opponent EPA/game", status: "insufficient_data", window: opponentWindow, snapshotId: cutoff.snapshotId, sourceFields: ["opponent.passing_epa", "opponent.rushing_epa"] })
      : metric({ value: defensiveEpa.value / opponentWindow.gameCount, unit: "opponent EPA/game", window: opponentWindow, denominator: opponentWindow.gameCount, snapshotId: cutoff.snapshotId, sourceFields: ["opponent.passing_epa", "opponent.rushing_epa"] }),
    completion_rate: ratio({ rows, numerator: "completions", denominator: "attempts", unit: "completions/attempt", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    passing_yards_per_attempt: ratio({ rows, numerator: "passing_yards", denominator: "attempts", unit: "passing yards/attempt", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    rushing_yards_per_carry: ratio({ rows, numerator: "rushing_yards", denominator: "carries", unit: "rushing yards/carry", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    passing_yards_allowed_per_attempt: ratio({ rows: opponent, numerator: "passing_yards", denominator: "attempts", unit: "opponent passing yards/attempt", window: opponentWindow, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    rushing_yards_allowed_per_carry: ratio({ rows: opponent, numerator: "rushing_yards", denominator: "carries", unit: "opponent rushing yards/carry", window: opponentWindow, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    turnovers,
    interceptions,
    fumbles_lost: fumblesLost,
    defensive_interceptions: defensiveInterceptions,
    fumble_recoveries: fumbleRecoveries,
    sacks,
    sacks_allowed: sacksAllowed,
    sack_rate_allowed: ratioOfSacksToPasses({ rows, sacksField: "sacks_suffered", attemptsField: "attempts", unit: "sacks/(attempts+sacks)", window, snapshotId: cutoff.snapshotId, minimumGames: minimum }),
    explosive_components: explosiveComponents,
    special_teams: specialTeams,
  };
}

function windowMetrics(cutoff: NflCutoffResult, observations: NflGameObservation[], kind: NflStatisticWindow["kind"], minimumGames: number): NflTeamWindowMetrics {
  const placeholder: NflMetricValue = metric({ value: null, unit: "unavailable", status: "insufficient_data", window: makeWindow(cutoff, kind, observations), snapshotId: cutoff.snapshotId, sourceFields: [] });
  const emptyRecord = Object.fromEntries(EXPLOSIVE_FIELDS.map((field) => [field, placeholder]));
  return addMetrics({
    passing_epa: placeholder, rushing_epa: placeholder, offensive_epa: placeholder,
    passing_epa_allowed: placeholder, rushing_epa_allowed: placeholder, defensive_epa_allowed: placeholder,
    passing_epa_per_game: placeholder, rushing_epa_per_game: placeholder, offensive_epa_per_game: placeholder, defensive_epa_allowed_per_game: placeholder,
    completion_rate: placeholder, passing_yards_per_attempt: placeholder, rushing_yards_per_carry: placeholder,
    passing_yards_allowed_per_attempt: placeholder, rushing_yards_allowed_per_carry: placeholder,
    turnovers: placeholder, interceptions: placeholder, fumbles_lost: placeholder, defensive_interceptions: placeholder,
    fumble_recoveries: placeholder, sacks: placeholder, sacks_allowed: placeholder, sack_rate_allowed: placeholder,
    explosive_components: emptyRecord, special_teams: Object.fromEntries(SPECIAL_TEAMS_FIELDS.map((field) => [field, placeholder])),
  }, cutoff, observations, kind, minimumGames);
}

function ratioOfSacksToPasses(args: {
  rows: Record<string, unknown>[];
  sacksField: string;
  attemptsField: string;
  unit: string;
  window: NflStatisticWindow;
  snapshotId: string;
  minimumGames: number;
}): NflMetricValue {
  if (args.rows.length < args.minimumGames) {
    return metric({ value: null, unit: args.unit, status: "insufficient_data", window: args.window, snapshotId: args.snapshotId, sourceFields: [args.sacksField, args.attemptsField] });
  }
  const values = args.rows.map((row) => [fieldValue(row, args.sacksField), fieldValue(row, args.attemptsField)] as const);
  if (values.some(([sacks, attempts]) => sacks === null || attempts === null)) {
    return metric({ value: null, unit: args.unit, status: "insufficient_data", window: args.window, snapshotId: args.snapshotId, sourceFields: [args.sacksField, args.attemptsField] });
  }
  const sacks = values.reduce((sum, [value]) => sum + (value ?? 0), 0);
  const attempts = values.reduce((sum, [, value]) => sum + (value ?? 0), 0);
  const denominator = sacks + attempts;
  if (denominator <= 0) return metric({ value: null, unit: args.unit, status: "insufficient_data", window: args.window, denominator, snapshotId: args.snapshotId, sourceFields: [args.sacksField, args.attemptsField] });
  return metric({ value: sacks / denominator, unit: args.unit, window: args.window, denominator, snapshotId: args.snapshotId, sourceFields: [args.sacksField, args.attemptsField] });
}

function weightedMetric(season: NflMetricValue, recent: NflMetricValue, metricName: string, additive: boolean): NflMetricValue {
  const sourceFields = [...new Set([...season.sourceFields, ...recent.sourceFields])];
  const window: NflStatisticWindow = {
    kind: "season_to_date",
    gameCount: season.window.gameCount,
    gameIds: season.window.gameIds,
    fromKickoff: season.window.fromKickoff,
    throughKickoff: season.window.throughKickoff,
  };
  if (season.status !== "available" || recent.status !== "available" || season.value === null || recent.value === null) {
    return metric({ value: null, unit: additive ? `${metricName}/team game (60/40)` : `${season.unit} (60/40)`, status: "insufficient_data", window, snapshotId: season.snapshotId, sourceFields });
  }
  const seasonValue = additive ? season.value / Math.max(1, season.window.gameCount) : season.value;
  const recentValue = additive ? recent.value / Math.max(1, recent.window.gameCount) : recent.value;
  return metric({
    value: seasonValue * 0.6 + recentValue * 0.4,
    unit: additive ? `${metricName}/team game (60/40)` : `${season.unit} (60/40)`,
    window,
    denominator: additive ? season.window.gameCount : null,
    snapshotId: season.snapshotId,
    sourceFields,
  });
}

function weightedMetrics(season: NflTeamWindowMetrics, recent: NflTeamWindowMetrics): NflTeamWindowMetrics {
  const combine = (field: keyof Omit<NflTeamWindowMetrics, "explosive_components" | "special_teams">) =>
    weightedMetric(season[field] as NflMetricValue, recent[field] as NflMetricValue, String(field), SUM_METRICS.has(String(field)));
  const explosive = Object.fromEntries(EXPLOSIVE_FIELDS.map((field) => [field,
    weightedMetric(season.explosive_components[field], recent.explosive_components[field], field, true)]));
  const special = Object.fromEntries(SPECIAL_TEAMS_FIELDS.map((field) => [field,
    weightedMetric(season.special_teams[field], recent.special_teams[field], field, true)]));
  for (const field of SPECIAL_TEAMS_RATIOS) {
    special[field] = weightedMetric(season.special_teams[field], recent.special_teams[field], field, false);
  }
  return {
    passing_epa: combine("passing_epa"), rushing_epa: combine("rushing_epa"), offensive_epa: combine("offensive_epa"),
    passing_epa_allowed: combine("passing_epa_allowed"), rushing_epa_allowed: combine("rushing_epa_allowed"), defensive_epa_allowed: combine("defensive_epa_allowed"),
    passing_epa_per_game: combine("passing_epa_per_game"), rushing_epa_per_game: combine("rushing_epa_per_game"), offensive_epa_per_game: combine("offensive_epa_per_game"), defensive_epa_allowed_per_game: combine("defensive_epa_allowed_per_game"),
    completion_rate: combine("completion_rate"), passing_yards_per_attempt: combine("passing_yards_per_attempt"), rushing_yards_per_carry: combine("rushing_yards_per_carry"),
    passing_yards_allowed_per_attempt: combine("passing_yards_allowed_per_attempt"), rushing_yards_allowed_per_carry: combine("rushing_yards_allowed_per_carry"),
    turnovers: combine("turnovers"), interceptions: combine("interceptions"), fumbles_lost: combine("fumbles_lost"),
    defensive_interceptions: combine("defensive_interceptions"), fumble_recoveries: combine("fumble_recoveries"), sacks: combine("sacks"),
    sacks_allowed: combine("sacks_allowed"), sack_rate_allowed: combine("sack_rate_allowed"),
    explosive_components: explosive, special_teams: special,
  };
}

function quarterbacksForCutoff(cutoff: NflCutoffResult): NflQuarterbackProfile[] {
  const groups = new Map<string, NflPlayerStatRow[]>();
  for (const row of cutoff.playerStats) {
    if (row.position !== "QB") continue;
    const key = typeof row.player_id === "string" && row.player_id ? row.player_id : `${row.team}:${row.player_display_name ?? "unknown"}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return [...groups.values()].map((rows) => {
    const first = rows[0];
    const makePlayerWindow = (kind: NflStatisticWindow["kind"], observations: NflGameObservation[]): NflStatisticWindow => ({
      kind,
      gameCount: observations.length,
      gameIds: observations.map(({ game }) => game.game_id),
      fromKickoff: observations[0]?.kickoff ?? null,
      throughKickoff: observations.at(-1)?.kickoff ?? null,
    });
    const seasonWindow = makePlayerWindow("season_to_date", cutoff.observations);
    const recentObservations = cutoff.observations.slice(-3);
    const recentWindow = makePlayerWindow("recent_3", recentObservations);
    const seasonGameIds = new Set(seasonWindow.gameIds);
    const recentGameIds = new Set(recentWindow.gameIds);
    const seasonRows = rows.filter((row) => seasonGameIds.has(row.game_id));
    const recentRows = rows.filter((row) => recentGameIds.has(row.game_id));
    const seasonBaseline = quarterbackMetrics(seasonRows, seasonWindow, cutoff.snapshotId, 1);
    const recentForm = quarterbackMetrics(recentRows, recentWindow, cutoff.snapshotId, 3);
    const weighted = Object.fromEntries(Object.entries(seasonBaseline).map(([name, seasonMetric]) => [name,
      weightedMetric(seasonMetric, recentForm[name], name,
        ["passing_epa", "passing_tds", "passing_interceptions", "sacks_suffered", "attempts"].includes(name))]));
    return {
      playerId: typeof first.player_id === "string" ? first.player_id : null,
      displayName: typeof first.player_display_name === "string" ? first.player_display_name : null,
      position: typeof first.position === "string" ? first.position : null,
      explicitlyLabeledAsStarter: false as const,
      seasonBaseline,
      recentForm,
      weighted,
    };
  }).sort((left, right) => (left.displayName ?? "").localeCompare(right.displayName ?? ""));
}

function quarterbackMetrics(
  rows: NflPlayerStatRow[],
  window: NflStatisticWindow,
  snapshotId: string,
  minimumGames: number,
): Record<string, NflMetricValue> {
  const passingEpaRows = rows.filter((row) => fieldValue(row, "passing_epa") !== null);
  const passingEpa = sumField({ rows: passingEpaRows, field: "passing_epa", unit: "EPA (nflverse total)", window, snapshotId, minimumGames });
  const attempts = sumField({ rows, field: "attempts", unit: "attempts", window, snapshotId, minimumGames });
  const cpoeRows = rows.filter((row) => fieldValue(row, "passing_cpoe") !== null && fieldValue(row, "attempts") !== null);
  const cpoeDenominator = cpoeRows.reduce((sum, row) => sum + (fieldValue(row, "attempts") ?? 0), 0);
  const cpoe = cpoeRows.length >= minimumGames && cpoeDenominator > 0
    ? metric({ value: cpoeRows.reduce((sum, row) => sum + (fieldValue(row, "passing_cpoe") ?? 0) * (fieldValue(row, "attempts") ?? 0), 0) / cpoeDenominator,
      unit: "attempt-weighted CPOE", window, denominator: cpoeDenominator, snapshotId, sourceFields: ["passing_cpoe", "attempts"] })
    : metric({ value: null, unit: "attempt-weighted CPOE", status: "insufficient_data", window, snapshotId, sourceFields: ["passing_cpoe", "attempts"] });
  return {
    passing_epa: passingEpa,
    passing_cpoe: cpoe,
    completion_rate: ratio({ rows, numerator: "completions", denominator: "attempts", unit: "completions/attempt", window, snapshotId, minimumGames }),
    passing_yards_per_attempt: ratio({ rows, numerator: "passing_yards", denominator: "attempts", unit: "passing yards/attempt", window, snapshotId, minimumGames }),
    passing_tds: sumField({ rows, field: "passing_tds", unit: "passing touchdowns", window, snapshotId, minimumGames }),
    passing_interceptions: sumField({ rows, field: "passing_interceptions", unit: "interceptions", window, snapshotId, minimumGames }),
    sacks_suffered: sumField({ rows, field: "sacks_suffered", unit: "sacks", window, snapshotId, minimumGames }),
    sack_rate: ratioOfSacksToPasses({ rows, sacksField: "sacks_suffered", attemptsField: "attempts", unit: "sacks/(attempts+sacks)", window, snapshotId, minimumGames }),
    attempts,
  };
}

export function aggregateNflTeamProfile(cutoff: NflCutoffResult) {
  const observations = cutoff.observations;
  const recent = observations.slice(-3);
  const seasonBaseline = windowMetrics(cutoff, observations, "season_to_date", 1);
  const recentForm = windowMetrics(cutoff, recent, "recent_3", 3);
  return {
    seasonBaseline,
    recentForm,
    weighted: weightedMetrics(seasonBaseline, recentForm),
    quarterbacks: quarterbacksForCutoff(cutoff),
  };
}

export function createNflMetric(args: {
  value: number | null;
  unit: string;
  status: NflMetricStatus;
  window: NflStatisticWindow;
  denominator?: number | null;
  snapshotId: string;
  sourceFields: string[];
}): NflMetricValue {
  return metric(args);
}
