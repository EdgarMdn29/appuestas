import type {
  NflCutoffResult,
  NflGameObservation,
  NflPlayerStatRow,
  NflScheduleGame,
  NflSnapshotInput,
  NflTeamStatRow,
} from "./types";

const easternFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function easternLocalDateTimeToUtc(gameday: string, gametime: string): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(gameday);
  const time = /^(\d{1,2}):(\d{2})\s*([AP]M)?$/i.exec(gametime.trim());
  if (!day || !time) return null;

  const [, yearText, monthText, dayText] = day;
  let hour = Number(time[1]);
  const minute = Number(time[2]);
  const meridiem = time[3]?.toUpperCase();
  if (minute > 59 || hour > 23 || (meridiem && (hour < 1 || hour > 12))) return null;
  if (meridiem) hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);

  const desired = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour,
    minute,
  };
  const desiredAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute);
  let candidate = desiredAsUtc;

  // Solve local Eastern wall time -> UTC using the zone's actual offset on that date.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(easternFormatter.formatToParts(new Date(candidate))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]));
    const renderedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    candidate += desiredAsUtc - renderedAsUtc;
  }

  const finalParts = Object.fromEntries(easternFormatter.formatToParts(new Date(candidate))
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
  if (finalParts.year !== desired.year || finalParts.month !== desired.month || finalParts.day !== desired.day
    || finalParts.hour !== desired.hour || finalParts.minute !== desired.minute) return null;

  return new Date(candidate);
}

function scheduleGameKickoff(game: NflScheduleGame): Date | null {
  return easternLocalDateTimeToUtc(game.gameday, game.gametime);
}

function numeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCompleted(game: NflScheduleGame): boolean {
  return numeric(game.home_score) && numeric(game.away_score);
}

function seasonTypeForGame(gameType: string): string {
  return gameType === "REG" ? "REG" : "POST";
}

/**
 * Selects only this snapshot's completed team games whose scheduled kickoff
 * is strictly before the target kickoff. Schedule gametime is NFLverse Eastern time.
 */
export function applyNflStatisticalCutoff(args: {
  snapshot: NflSnapshotInput;
  team: string;
  targetGameId: string;
  targetKickoff: string;
}): NflCutoffResult {
  const { snapshot, team, targetGameId } = args;
  const targetTime = new Date(args.targetKickoff);
  if (!Number.isFinite(targetTime.getTime()) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(args.targetKickoff)) {
    throw new Error("targetKickoff must be an ISO timestamp with an explicit timezone");
  }
  const snapshotTime = new Date(snapshot.captured_at);
  if (!Number.isFinite(snapshotTime.getTime()) || snapshotTime.getTime() >= targetTime.getTime()) {
    throw new Error("Selected snapshot was not captured before the target kickoff; historical pregame data is unavailable");
  }

  const scheduleRows = snapshot.data.schedule.rows as NflScheduleGame[];
  const targetGame = scheduleRows.find((game) => game.game_id === targetGameId);
  if (!targetGame || targetGame.season !== snapshot.season) throw new Error("Target game is not in the selected snapshot season");
  if (team !== targetGame.home_team && team !== targetGame.away_team) {
    throw new Error("team must be one of the target game's home_team or away_team");
  }

  const derivedTargetTime = scheduleGameKickoff(targetGame);
  if (!derivedTargetTime || derivedTargetTime.getTime() !== targetTime.getTime()) {
    throw new Error("targetKickoff does not match the target game's NFLverse schedule kickoff");
  }

  const targetSeasonType = seasonTypeForGame(targetGame.game_type);
  const teamStats = snapshot.data.teamStats.rows as NflTeamStatRow[];
  const teamRowsByGame = new Map(teamStats
    .filter((row) => row.team === team && row.season === snapshot.season && row.season_type === targetSeasonType)
    .map((row) => [row.game_id, row]));

  const observations: NflGameObservation[] = [];
  const excludedGameIds: string[] = [];
  for (const game of scheduleRows) {
    if (game.season !== snapshot.season || game.game_type === undefined) continue;
    if (game.home_team !== team && game.away_team !== team) continue;
    const kickoff = scheduleGameKickoff(game);
    if (game.game_id === targetGameId || !kickoff || kickoff.getTime() >= targetTime.getTime()
      || !isCompleted(game) || seasonTypeForGame(game.game_type) !== targetSeasonType) {
      excludedGameIds.push(game.game_id);
      continue;
    }

    const teamStat = teamRowsByGame.get(game.game_id);
    if (!teamStat || teamStat.opponent_team !== (team === game.home_team ? game.away_team : game.home_team)) {
      excludedGameIds.push(game.game_id);
      continue;
    }
    observations.push({ game, kickoff: kickoff.toISOString(), teamStat });
  }

  observations.sort((left, right) => left.kickoff.localeCompare(right.kickoff)
    || left.game.game_id.localeCompare(right.game.game_id));
  const eligibleGameIds = new Set(observations.map(({ game }) => game.game_id));
  const opponentStats = teamStats.filter((row) => eligibleGameIds.has(row.game_id)
    && row.season === snapshot.season && row.season_type === targetSeasonType
    && row.team !== team && row.opponent_team === team);
  const playerStats = (snapshot.data.playerStats.rows as NflPlayerStatRow[])
    .filter((row) => row.team === team && row.season === snapshot.season && row.season_type === targetSeasonType
      && eligibleGameIds.has(row.game_id));

  return {
    snapshotId: snapshot.id,
    snapshotCapturedAt: snapshotTime.toISOString(),
    season: snapshot.season,
    targetGame,
    targetKickoff: targetTime.toISOString(),
    asOf: targetTime.toISOString(),
    team,
    teamSide: targetGame.home_team === team ? "HOME" : "AWAY",
    observations,
    opponentStats,
    playerStats,
    excludedGameIds: [...new Set(excludedGameIds)].sort(),
  };
}

export function getNflScheduleKickoffUtc(game: NflScheduleGame): string | null {
  return scheduleGameKickoff(game)?.toISOString() ?? null;
}
