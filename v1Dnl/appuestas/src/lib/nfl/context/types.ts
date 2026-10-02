import type {
  NflMetricStatus,
  NflMetricValue,
  NflQuarterbackProfile,
  NflScheduleGame,
  NflSnapshotInput,
  NflTeamProfile,
} from "../statistics/types";

export type NflContextSide = "HOME" | "AWAY";
export type NflAvailabilityStatus = "available" | "insufficient_data" | "unavailable";

export type NflMetricComparison = {
  offense: NflMetricValue;
  opponentDefense: NflMetricValue;
  difference: NflMetricValue;
};

export type NflObservedQuarterback = {
  playerId: string | null;
  displayName: string | null;
  position: string | null;
  seasonBaseline: NflQuarterbackProfile["seasonBaseline"];
  recentForm: NflQuarterbackProfile["recentForm"];
  weighted: NflQuarterbackProfile["weighted"];
  derivedRates: {
    seasonPassingTdRate: NflMetricValue;
    recentPassingTdRate: NflMetricValue;
    weightedPassingTdRate: NflMetricValue;
    seasonInterceptionRate: NflMetricValue;
    recentInterceptionRate: NflMetricValue;
    weightedInterceptionRate: NflMetricValue;
  };
};

export type NflTeamMatchup = {
  team: string;
  side: NflContextSide;
  pass: {
    passingEpaPerGame: NflMetricComparison;
    yardsPerAttempt: NflMetricComparison;
    completionRate: NflMetricComparison;
  };
  rush: {
    rushingEpaPerGame: NflMetricComparison;
    yardsPerCarry: NflMetricComparison;
  };
  qb: {
    starting_qb_status: "unavailable";
    observedCandidates: NflObservedQuarterback[];
  };
};

export type NflSosSide = {
  value: number | null;
  gamesConsidered: number;
  opponentsConsidered: number;
  ratedOpponentGames: number;
  status: NflAvailabilityStatus;
  window: {
    season: number;
    gameType: "REG" | "POST";
    cutoff: string;
    gameIds: string[];
  };
  opponentRecords: Array<{
    gameId: string;
    opponent: string;
    winPct: number | null;
    completedGames: number;
  }>;
};

export type NflTeamDivisionHistory = {
  wins: number;
  losses: number;
  ties: number;
  averageMargin: number | null;
  gamesConsidered: number;
  status: NflAvailabilityStatus;
  gameIds: string[];
};

export type NflByeStatus = "inferred" | "none" | "ambiguous" | "insufficient_data" | "postseason";

export type NflTeamBye = {
  byeWeek: number | null;
  byeBeforeTarget: boolean | null;
  status: NflByeStatus;
  scheduledRegularSeasonGames: number;
};

export type NflContextMetric<T> = {
  value: T | null;
  status: NflMetricStatus;
  sourceFields: string[];
  snapshotId: string;
};

export type NflGameContext = {
  snapshotId: string;
  snapshotCapturedAt: string;
  season: number;
  gameId: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  matchup: {
    home: NflTeamMatchup;
    away: NflTeamMatchup;
  };
  context: {
    location: {
      home: NflContextMetric<"HOME" | "NEUTRAL">;
      away: NflContextMetric<"AWAY" | "NEUTRAL">;
    };
    rest: {
      homeRest: NflContextMetric<number>;
      awayRest: NflContextMetric<number>;
      rest_advantage: NflContextMetric<number>;
    };
    bye: {
      home: NflTeamBye;
      away: NflTeamBye;
    };
    travel: { status: "unavailable"; reason: string };
    venue: {
      stadium: NflContextMetric<string>;
      surface: NflContextMetric<string>;
      roof: NflContextMetric<string>;
    };
    weather: { status: "unavailable"; reason: string };
  };
  sos: {
    home: NflSosSide;
    away: NflSosSide;
    differential: NflMetricValue;
  };
  division: {
    isDivisional: NflContextMetric<boolean>;
    homeHistory: NflTeamDivisionHistory;
    awayHistory: NflTeamDivisionHistory;
  };
  availability: {
    injuries: "unavailable";
    startingQb: "unavailable";
  };
};

export type NflContextEngineInput = {
  snapshot: NflSnapshotInput;
  gameId: string;
  kickoff: string;
};

export type NflContextBuildContext = {
  snapshot: NflSnapshotInput;
  targetGame: NflScheduleGame;
  targetKickoff: string;
  homeProfile: NflTeamProfile;
  awayProfile: NflTeamProfile;
};
