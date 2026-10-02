import { buildNflTeamStatisticalProfile } from "@/lib/nfl/statistics/profile";
import { getNflScheduleKickoffUtc } from "@/lib/nfl/statistics/cutoff";
import type { NflScheduleGame } from "@/lib/nfl/statistics/types";
import { buildNflContextFields } from "./context";
import { buildNflDivisionContext } from "./division";
import { buildNflMatchup } from "./matchup";
import { buildNflStrengthOfSchedule } from "./sos";
import type { NflContextBuildContext, NflContextEngineInput, NflGameContext } from "./types";

export function buildNflGameContext(input: NflContextEngineInput): NflGameContext {
  const { snapshot, gameId, kickoff } = input;
  if (!snapshot.id || !snapshot.captured_at || !snapshot.data || snapshot.data.league !== "nfl") {
    throw new Error("A complete NFL snapshot is required");
  }
  if (snapshot.data.season !== snapshot.season) throw new Error("Snapshot payload season does not match snapshot metadata");

  const schedule = snapshot.data.schedule.rows as NflScheduleGame[];
  const targetGame = schedule.find((game) => game.game_id === gameId);
  if (!targetGame || targetGame.season !== snapshot.season) throw new Error("gameId is not present in the selected snapshot");
  const scheduledKickoff = getNflScheduleKickoffUtc(targetGame);
  if (!scheduledKickoff || Date.parse(scheduledKickoff) !== Date.parse(kickoff)) {
    throw new Error("kickoff does not match the selected game's schedule timestamp");
  }

  const homeProfile = buildNflTeamStatisticalProfile({ snapshot, team: targetGame.home_team, targetGameId: gameId, targetKickoff: kickoff });
  const awayProfile = buildNflTeamStatisticalProfile({ snapshot, team: targetGame.away_team, targetGameId: gameId, targetKickoff: kickoff });
  if (homeProfile.snapshotId !== snapshot.id || awayProfile.snapshotId !== snapshot.id
    || homeProfile.targetGameId !== gameId || awayProfile.targetGameId !== gameId
    || homeProfile.teamSide !== "HOME" || awayProfile.teamSide !== "AWAY") {
    throw new Error("Home and away profiles do not match the requested snapshot and game");
  }

  const context: NflContextBuildContext = {
    snapshot,
    targetGame,
    targetKickoff: homeProfile.targetKickoff,
    homeProfile,
    awayProfile,
  };
  const contextFields = buildNflContextFields(context);
  return {
    snapshotId: snapshot.id,
    snapshotCapturedAt: homeProfile.snapshotCapturedAt,
    season: snapshot.season,
    gameId,
    kickoff: homeProfile.targetKickoff,
    homeTeam: targetGame.home_team,
    awayTeam: targetGame.away_team,
    matchup: buildNflMatchup(homeProfile, awayProfile),
    context: contextFields.context,
    sos: buildNflStrengthOfSchedule(context),
    division: buildNflDivisionContext(context),
    availability: contextFields.availability,
  };
}
