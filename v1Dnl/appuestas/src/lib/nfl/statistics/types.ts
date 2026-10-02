import type { NflSnapshotRecord } from "../types";

export type NflStatRow = Record<string, string | number | null>;

export type NflScheduleGame = NflStatRow & {
  game_id: string;
  season: number;
  week: number;
  game_type: string;
  gameday: string;
  gametime: string;
  home_team: string;
  away_team: string;
};

export type NflTeamStatRow = NflStatRow & {
  game_id: string;
  season: number;
  week: number;
  season_type: string;
  team: string;
  opponent_team: string;
};

export type NflPlayerStatRow = NflStatRow & {
  game_id: string;
  season: number;
  week: number;
  season_type: string;
  team: string;
  opponent_team: string;
};

export type NflStatisticWindow = {
  kind: "season_to_date" | "recent_3" | "single_game";
  gameCount: number;
  gameIds: string[];
  fromKickoff: string | null;
  throughKickoff: string | null;
};

export type NflMetricStatus = "available" | "insufficient_data" | "unavailable";

export type NflMetricValue = {
  value: number | null;
  unit: string;
  status: NflMetricStatus;
  window: NflStatisticWindow;
  denominator: number | null;
  snapshotId: string;
  sourceFields: string[];
};

export type NflGameObservation = {
  game: NflScheduleGame;
  kickoff: string;
  teamStat: NflTeamStatRow;
};

export type NflCutoffResult = {
  snapshotId: string;
  snapshotCapturedAt: string;
  season: number;
  targetGame: NflScheduleGame;
  targetKickoff: string;
  asOf: string;
  team: string;
  teamSide: "HOME" | "AWAY";
  observations: NflGameObservation[];
  opponentStats: NflTeamStatRow[];
  playerStats: NflPlayerStatRow[];
  excludedGameIds: string[];
};

export type NflTeamWindowMetrics = {
  passing_epa: NflMetricValue;
  rushing_epa: NflMetricValue;
  offensive_epa: NflMetricValue;
  passing_epa_allowed: NflMetricValue;
  rushing_epa_allowed: NflMetricValue;
  defensive_epa_allowed: NflMetricValue;
  passing_epa_per_game: NflMetricValue;
  rushing_epa_per_game: NflMetricValue;
  offensive_epa_per_game: NflMetricValue;
  defensive_epa_allowed_per_game: NflMetricValue;
  completion_rate: NflMetricValue;
  passing_yards_per_attempt: NflMetricValue;
  rushing_yards_per_carry: NflMetricValue;
  passing_yards_allowed_per_attempt: NflMetricValue;
  rushing_yards_allowed_per_carry: NflMetricValue;
  turnovers: NflMetricValue;
  interceptions: NflMetricValue;
  fumbles_lost: NflMetricValue;
  defensive_interceptions: NflMetricValue;
  fumble_recoveries: NflMetricValue;
  sacks: NflMetricValue;
  sacks_allowed: NflMetricValue;
  sack_rate_allowed: NflMetricValue;
  explosive_components: Record<string, NflMetricValue>;
  special_teams: Record<string, NflMetricValue>;
};

export type NflTeamProfile = {
  snapshotId: string;
  snapshotCapturedAt: string;
  season: number;
  team: string;
  teamSide: "HOME" | "AWAY";
  targetGameId: string;
  targetKickoff: string;
  cutoff: NflCutoffResult;
  seasonBaseline: NflTeamWindowMetrics;
  recentForm: NflTeamWindowMetrics;
  weighted: NflTeamWindowMetrics;
  quarterbacks: NflQuarterbackProfile[];
  unavailable: Record<string, { status: "unavailable"; reason: string; snapshotId: string }>;
};

export type NflQuarterbackProfile = {
  playerId: string | null;
  displayName: string | null;
  position: string | null;
  explicitlyLabeledAsStarter: false;
  seasonBaseline: Record<string, NflMetricValue>;
  recentForm: Record<string, NflMetricValue>;
  weighted: Record<string, NflMetricValue>;
};

export type NflSnapshotInput = Pick<NflSnapshotRecord, "id" | "season" | "captured_at" | "data">;
