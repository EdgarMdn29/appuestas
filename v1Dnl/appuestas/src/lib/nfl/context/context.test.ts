import assert from "node:assert/strict";
import test from "node:test";
import { applyNflStatisticalCutoff } from "../statistics/cutoff";
import type { NflMetricValue, NflTeamProfile } from "../statistics/types";
import { buildNflContextFields } from "./context";
import { buildNflDivisionContext } from "./division";
import { buildNflMatchup } from "./matchup";
import { buildNflStrengthOfSchedule } from "./sos";
import type { NflContextBuildContext } from "./types";

const snapshotId = "11111111-1111-4111-8111-111111111111";
const capturedAt = "2026-10-01T00:00:00.000Z";
const targetKickoff = "2026-10-11T17:00:00.000Z";

function scheduleGame(args: {
  id: string; date: string; time?: string; home: string; away: string; week: number;
  homeScore?: number | null; awayScore?: number | null; div?: boolean; type?: string;
  location?: string; homeRest?: number; awayRest?: number;
}): Record<string, string | number | boolean | null> {
  return {
    game_id: args.id, season: 2026, week: args.week, game_type: args.type ?? "REG",
    gameday: args.date, gametime: args.time ?? "01:00 PM", home_team: args.home, away_team: args.away,
    home_score: args.homeScore ?? null, away_score: args.awayScore ?? null, div_game: args.div ?? false,
    location: args.location ?? "Home", home_rest: args.homeRest ?? 7, away_rest: args.awayRest ?? 7,
    stadium: "Test Stadium", surface: "turf", roof: "outdoors",
  };
}

function metric(value: number | null, unit = "test"): NflMetricValue {
  return {
    value, unit, status: value === null ? "insufficient_data" : "available",
    window: { kind: "season_to_date", gameCount: 4, gameIds: ["g1", "g2", "g3", "g4"], fromKickoff: null, throughKickoff: targetKickoff },
    denominator: null, snapshotId, sourceFields: [unit],
  };
}

function profile(team: string, side: "HOME" | "AWAY", values: Partial<Record<string, number>> = {}): NflTeamProfile {
  const weighted = {
    passing_epa_per_game: metric(values.passEpa ?? 4),
    passing_yards_per_attempt: metric(values.ypa ?? 7),
    completion_rate: metric(values.comp ?? 0.6),
    passing_yards_allowed_per_attempt: metric(values.ypaAllowed ?? 6),
    rushing_epa_per_game: metric(values.rushEpa ?? 2),
    rushing_yards_per_carry: metric(values.ypc ?? 4),
    rushing_yards_allowed_per_carry: metric(values.ypcAllowed ?? 3.5),
  } as unknown as NflTeamProfile["weighted"];
  const windowMetrics = {
    passing_epa_per_game: metric(values.passEpa ?? 4),
    rushing_epa_per_game: metric(values.rushEpa ?? 2),
    completion_rate: metric(values.comp ?? 0.6),
  } as unknown as NflTeamProfile["seasonBaseline"];
  const rows = ["g1", "g2", "g3", "g4"].map((game_id) => ({ game_id, completions: 20, attempts: 30,
    passing_epa: values.passAllowed ?? 2, rushing_epa: values.rushAllowed ?? 1 }));
  return {
    snapshotId, snapshotCapturedAt: capturedAt, season: 2026, team, teamSide: side, targetGameId: "target", targetKickoff,
    cutoff: { snapshotId, snapshotCapturedAt: capturedAt, season: 2026,
      targetGame: scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6 }) as never,
      targetKickoff, asOf: targetKickoff, team, teamSide: side, observations: [], opponentStats: rows as never,
      playerStats: [], excludedGameIds: [] },
    seasonBaseline: windowMetrics, recentForm: windowMetrics, weighted,
    quarterbacks: [], unavailable: {},
  };
}

function context(schedule: Record<string, string | number | boolean | null>[], target = schedule.find((game) => game.game_id === "target")!): NflContextBuildContext {
  const data = { league: "nfl", season: 2026, capturedAt, source: "nflverse", sourceVersion: "test",
    schedule: { url: "test", etag: null, lastModified: null, rowCount: schedule.length, rows: schedule },
    teamStats: { url: "test", etag: null, lastModified: null, rowCount: 0, rows: [] },
    playerStats: { url: "test", etag: null, lastModified: null, rowCount: 0, rows: [] } };
  const snapshot = { id: snapshotId, season: 2026, captured_at: capturedAt, data } as never;
  const targetGame = target as never;
  return { snapshot, targetGame, targetKickoff, homeProfile: profile("HOME", "HOME"), awayProfile: profile("AWAY", "AWAY") };
}

test("1. matchup sides retain correct HOME/AWAY orientation", () => {
  const result = buildNflMatchup(profile("HOME", "HOME"), profile("AWAY", "AWAY"));
  assert.equal(result.home.team, "HOME"); assert.equal(result.home.side, "HOME");
  assert.equal(result.away.team, "AWAY"); assert.equal(result.away.side, "AWAY");
});

test("2. pass matchup preserves offense, opponent defense, and difference", () => {
  const result = buildNflMatchup(profile("HOME", "HOME", { passEpa: 6 }), profile("AWAY", "AWAY", { passAllowed: 2 }));
  assert.equal(result.home.pass.passingEpaPerGame.offense.value, 6);
  assert.equal(result.home.pass.passingEpaPerGame.opponentDefense.value, 2);
  assert.equal(result.home.pass.passingEpaPerGame.difference.value, 4);
});

test("3. rush matchup preserves offense, opponent defense, and difference", () => {
  const result = buildNflMatchup(profile("HOME", "HOME", { rushEpa: 3, ypc: 5 }), profile("AWAY", "AWAY", { rushAllowed: -1, ypcAllowed: 4 }));
  assert.equal(result.home.rush.rushingEpaPerGame.difference.value, 4);
  assert.equal(result.home.rush.yardsPerCarry.difference.value, 1);
});

test("4. QB candidates stay distinct and no starter is selected", () => {
  const qbMetrics = { attempts: metric(10), passing_tds: metric(2), passing_interceptions: metric(1) };
  const qb = { playerId: "q1", displayName: "QB One", position: "QB", explicitlyLabeledAsStarter: false as const,
    seasonBaseline: qbMetrics, recentForm: qbMetrics, weighted: qbMetrics };
  const observed = buildNflMatchup({ ...profile("HOME", "HOME"), quarterbacks: [qb, { ...qb, playerId: "q2", displayName: "QB Two" }] }, profile("AWAY", "AWAY"));
  assert.equal(observed.home.qb.starting_qb_status, "unavailable");
  assert.deepEqual(observed.home.qb.observedCandidates.map((candidate) => candidate.playerId), ["q1", "q2"]);
});

test("5. rest advantage is home rest minus away rest", () => {
  const target = scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6, homeRest: 10, awayRest: 7 });
  const result = buildNflContextFields(context([target])).context;
  assert.equal(result.rest.rest_advantage.value, 3);
});

test("6. neutral-site game is categorical", () => {
  const target = scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6, location: "Neutral" });
  const result = buildNflContextFields(context([target])).context.location;
  assert.equal(result.home.value, "NEUTRAL"); assert.equal(result.away.value, "NEUTRAL");
  assert.equal(result.home.status, "available");
});

test("7. SOS uses only records completed before target kickoff", () => {
  const games = [
    scheduleGame({ id: "prior-home", date: "2026-09-20", home: "HOME", away: "RIVAL", week: 3, homeScore: 20, awayScore: 10 }),
    scheduleGame({ id: "prior-away", date: "2026-09-20", home: "OTHER", away: "AWAY", week: 3, homeScore: 0, awayScore: 10 }),
    scheduleGame({ id: "rival-win", date: "2026-09-27", home: "RIVAL", away: "OTHER", week: 4, homeScore: 21, awayScore: 7 }),
    scheduleGame({ id: "future-rival-loss", date: "2026-10-18", home: "RIVAL", away: "OTHER", week: 7, homeScore: 0, awayScore: 30 }),
    scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6 }),
  ];
  const result = buildNflStrengthOfSchedule(context(games));
  assert.equal(result.home.value, 0.5); assert.deepEqual(result.home.window.gameIds, ["prior-home"]);
  assert.equal(result.home.opponentRecords[0].completedGames, 2);
});

test("8. division history selects the last three completed same-season games", () => {
  const games = [
    scheduleGame({ id: "old", date: "2026-09-06", home: "HOME", away: "R1", week: 1, homeScore: 7, awayScore: 0, div: true }),
    scheduleGame({ id: "d2", date: "2026-09-13", home: "R2", away: "HOME", week: 2, homeScore: 10, awayScore: 3, div: true }),
    scheduleGame({ id: "d3", date: "2026-09-20", home: "HOME", away: "R3", week: 3, homeScore: 14, awayScore: 14, div: true }),
    scheduleGame({ id: "d4", date: "2026-09-27", home: "R4", away: "HOME", week: 4, homeScore: 0, awayScore: 6, div: true }),
    scheduleGame({ id: "future", date: "2026-10-18", home: "HOME", away: "R5", week: 7, homeScore: 30, awayScore: 0, div: true }),
    scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6 }),
  ];
  const result = buildNflDivisionContext(context(games)).homeHistory;
  assert.deepEqual(result.gameIds, ["d2", "d3", "d4"]);
  assert.deepEqual([result.wins, result.losses, result.ties], [1, 1, 1]);
  assert.ok(Math.abs(result.averageMargin! - (-1 / 3)) < 1e-9);
});

test("9. games at or after target kickoff cannot enter division history", () => {
  const games = [scheduleGame({ id: "same-time", date: "2026-10-11", home: "HOME", away: "R1", week: 6, homeScore: 30, awayScore: 0, div: true }),
    scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6 })];
  assert.equal(buildNflDivisionContext(context(games)).homeHistory.gamesConsidered, 0);
});

test("10. statistical cutoff rejects a snapshot captured after kickoff", () => {
  const snapshot = { id: snapshotId, season: 2026, captured_at: "2026-10-12T00:00:00Z", data: {
    season: 2026, schedule: { rows: [scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6 })] },
    teamStats: { rows: [] }, playerStats: { rows: [] },
  } } as never;
  assert.throws(() => applyNflStatisticalCutoff({ snapshot, team: "HOME", targetGameId: "target", targetKickoff }), /not captured before/);
});

test("11. observed weather fields do not enter pregame context", () => {
  const target = { ...scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6 }), temp: 78, wind: 12 };
  const result = buildNflContextFields(context([target])).context.weather;
  assert.equal(result.status, "unavailable");
  assert.equal("temp" in result, false); assert.equal("wind" in result, false);
});

test("12. injury availability remains explicitly unavailable", () => {
  assert.equal(buildNflContextFields(context([scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6 })])).availability.injuries, "unavailable");
});

test("13. travel remains explicitly unavailable", () => {
  assert.equal(buildNflContextFields(context([scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6 })])).context.travel.status, "unavailable");
});

test("14. bye inference is ambiguous when 17 games do not cover 17 unique weeks", () => {
  const games = Array.from({ length: 16 }, (_, index) => scheduleGame({ id: `h${index}`, date: `2026-09-${String(1 + index).padStart(2, "0")}`,
    home: index === 16 ? "R" : "HOME", away: index === 16 ? "HOME" : `R${index}`, week: index === 16 ? 1 : Math.min(index + 1, 16) }));
  games.push(scheduleGame({ id: "target", date: "2026-10-11", home: "HOME", away: "AWAY", week: 6 }));
  const bye = buildNflContextFields(context(games)).context.bye.home;
  assert.equal(bye.status, "ambiguous"); assert.equal(bye.scheduledRegularSeasonGames, 17);
});
