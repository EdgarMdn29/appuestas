import { aggregateNflTeamProfile } from "@/lib/nfl/statistics/aggregate";
import { applyNflStatisticalCutoff } from "@/lib/nfl/statistics/cutoff";
import { NFL_UNAVAILABLE_METRICS } from "@/lib/nfl/statistics/metrics";
import type { NflSnapshotInput, NflTeamProfile } from "@/lib/nfl/statistics/types";

export function buildNflTeamStatisticalProfile(args: {
  snapshot: NflSnapshotInput;
  team: string;
  targetGameId: string;
  targetKickoff: string;
}): NflTeamProfile {
  const cutoff = applyNflStatisticalCutoff(args);
  const aggregated = aggregateNflTeamProfile(cutoff);
  return {
    snapshotId: cutoff.snapshotId,
    snapshotCapturedAt: cutoff.snapshotCapturedAt,
    season: cutoff.season,
    team: cutoff.team,
    teamSide: cutoff.teamSide,
    targetGameId: cutoff.targetGame.game_id,
    targetKickoff: cutoff.targetKickoff,
    cutoff,
    seasonBaseline: aggregated.seasonBaseline,
    recentForm: aggregated.recentForm,
    weighted: aggregated.weighted,
    quarterbacks: aggregated.quarterbacks,
    unavailable: Object.fromEntries(Object.entries(NFL_UNAVAILABLE_METRICS).map(([name, reason]) => [name, {
      status: "unavailable" as const,
      reason,
      snapshotId: cutoff.snapshotId,
    }])),
  };
}
