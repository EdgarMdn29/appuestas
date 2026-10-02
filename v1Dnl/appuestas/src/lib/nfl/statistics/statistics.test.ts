import assert from "node:assert/strict";
import test from "node:test";
import { aggregateNflTeamProfile } from "./aggregate";
import { applyNflStatisticalCutoff } from "./cutoff";
import type { NflSnapshotInput } from "./types";
import { NFL_UNAVAILABLE_METRICS } from "./metrics";

function fixtureSnapshot(): NflSnapshotInput {
  const games = [
    ["g1", "2026-09-06", "1:00PM", "NYJ", 1],
    ["g2", "2026-09-13", "1:00PM", "BUF", 2],
    ["g3", "2026-09-20", "1:00PM", "MIA", 3],
    // A same-week game before the target kickoff is eligible by time.
    ["g4", "2026-10-04", "1:00PM", "PIT", 4],
    ["target", "2026-10-04", "8:20PM", "KC", 5],
    // A later game deliberately has scores and stats; it must still be excluded.
    ["future", "2026-10-11", "1:00PM", "LAC", 6],
  ] as const;
  const schedule = games.map(([game_id, gameday, gametime, opponent, week], index) => ({
    game_id,
    season: 2026,
    week: week <= 4 ? week : 5,
    game_type: "REG",
    gameday,
    gametime,
    home_team: index % 2 === 0 ? "NE" : opponent,
    away_team: index % 2 === 0 ? opponent : "NE",
    home_score: index === 4 ? null : 20 + index,
    away_score: index === 4 ? null : 17 + index,
  }));
  const teamStats: Array<Record<string, string | number | null>> = [];
  for (let index = 0; index < games.length; index += 1) {
    const [game_id, , , opponent, week] = games[index];
    const passingEpa = index + 1;
    const rushingEpa = (index + 1) * 2;
    const neHome = index % 2 === 0;
    teamStats.push({
      season: 2026, season_type: "REG", week: week <= 4 ? week : 5, game_id, team: "NE", opponent_team: opponent,
      passing_epa: passingEpa, rushing_epa: rushingEpa, attempts: index === 0 ? 10 : 30,
      completions: index === 0 ? 5 : 21, passing_yards: index === 0 ? 100 : 300,
      passing_tds: 1, passing_interceptions: index === 1 ? 1 : 0, carries: 10,
      rushing_yards: index * 10, rushing_tds: 0, sacks_suffered: 1, def_sacks: 2,
      fumbles_lost_total: index === 2 ? 1 : 0, def_interceptions: 1, fumble_recovery_opp: 1,
      passing_20: 1, passing_40: 0, rushing_10: 1, rushing_12: 0, rushing_20: 0, rushing_40: 0,
      receiving_20: 1, receiving_40: 0,
      fg_att: index === 0 ? 1 : 1, fg_made: index === 0 ? 0 : 1, pat_att: 1, pat_made: 1,
      pt_att: 1, pt_yards: index === 0 ? 30 : 40, pt_net_yards: index === 0 ? 25 : 35,
      kickoff_returns: 1, kickoff_return_yards: index === 0 ? 10 : 20, punt_returns: 1, punt_return_yards: index === 0 ? 5 : 10,
    });
    teamStats.push({
      season: 2026, season_type: "REG", week: week <= 4 ? week : 5, game_id, team: opponent, opponent_team: "NE",
      passing_epa: 100 + index, rushing_epa: 200 + index, attempts: 20, completions: 10, passing_yards: 200,
      passing_tds: 1, passing_interceptions: 0, carries: 20, rushing_yards: 100, rushing_tds: 0,
      sacks_suffered: 1, def_sacks: 1, fumbles_lost_total: 0, def_interceptions: 0, fumble_recovery_opp: 0,
    });
  }
  const playerStats: Array<Record<string, string | number | null>> = [];
  for (const index of [0, 1, 2, 3, 4, 5]) {
    const [game_id, , , opponent, week] = games[index];
    playerStats.push({
      season: 2026, season_type: "REG", week: week <= 4 ? week : 5, game_id, team: "NE", opponent_team: opponent,
      player_id: index === 0 ? "qb-old" : "qb-new", player_display_name: index === 0 ? "QB One" : "QB Two", position: "QB",
      attempts: index === 0 ? 10 : 30, completions: index === 0 ? 5 : 21, passing_yards: index === 0 ? 100 : 300,
      passing_tds: 1, passing_interceptions: 0, sacks_suffered: 1, passing_epa: index + 0.5, passing_cpoe: 0.05,
    });
  }
  teamStats.push({ season: 2025, season_type: "REG", week: 18, game_id: "prior-season", team: "NE", opponent_team: "NYJ", passing_epa: 999, rushing_epa: 999 });

  return {
    id: "snapshot-2026",
    season: 2026,
    captured_at: "2026-10-01T21:02:42.913Z",
    data: {
      league: "nfl", season: 2026, capturedAt: "2026-10-01T21:02:42.913Z", source: "nflverse", sourceVersion: "test",
      schedule: { url: "fixture", etag: null, lastModified: null, rowCount: schedule.length, rows: schedule },
      teamStats: { url: "fixture", etag: null, lastModified: null, rowCount: teamStats.length, rows: teamStats },
      playerStats: { url: "fixture", etag: null, lastModified: null, rowCount: playerStats.length, rows: playerStats },
    },
  };
}

const targetKickoff = "2026-10-05T00:20:00.000Z"; // Sunday 8:20 PM America/New_York, EDT.

test("cutoff excludes target/future rows, includes prior and same-week earlier kickoff", () => {
  const cutoff = applyNflStatisticalCutoff({ snapshot: fixtureSnapshot(), team: "NE", targetGameId: "target", targetKickoff });
  assert.deepEqual(cutoff.observations.map(({ game }) => game.game_id), ["g1", "g2", "g3", "g4"]);
  assert.ok(cutoff.excludedGameIds.includes("target"));
  assert.ok(cutoff.excludedGameIds.includes("future"));
  assert.equal(cutoff.playerStats.some((row) => row.game_id === "target" || row.game_id === "future"), false);
});

test("recent form selects exactly the last three completed games and season baseline uses only this season", () => {
  const cutoff = applyNflStatisticalCutoff({ snapshot: fixtureSnapshot(), team: "NE", targetGameId: "target", targetKickoff });
  const metrics = aggregateNflTeamProfile(cutoff);
  assert.deepEqual(metrics.recentForm.offensive_epa.window.gameIds, ["g2", "g3", "g4"]);
  assert.deepEqual(metrics.seasonBaseline.offensive_epa.window.gameIds, ["g1", "g2", "g3", "g4"]);
  assert.equal(metrics.seasonBaseline.passing_epa.value, 10);
  assert.equal(metrics.seasonBaseline.rushing_epa.value, 20);
  assert.equal(metrics.seasonBaseline.offensive_epa.value, 30);
});

test("Week 1 yields explicit insufficient data and does not borrow a prior season", () => {
  const snapshot = fixtureSnapshot();
  snapshot.captured_at = "2026-09-05T20:00:00.000Z";
  const target = snapshot.data.schedule.rows.find((row) => row.game_id === "g1")!;
  const result = applyNflStatisticalCutoff({ snapshot, team: "NE", targetGameId: "g1", targetKickoff: "2026-09-06T17:00:00.000Z" });
  const metrics = aggregateNflTeamProfile(result);
  assert.equal(result.observations.length, 0);
  assert.equal(metrics.seasonBaseline.offensive_epa.status, "insufficient_data");
  assert.equal(metrics.recentForm.offensive_epa.value, null);
  assert.equal(target.season, 2026);
});

test("a snapshot captured after the target kickoff is rejected to prevent data-availability leakage", () => {
  const snapshot = fixtureSnapshot();
  snapshot.captured_at = "2026-10-05T00:20:00.000Z";
  assert.throws(() => applyNflStatisticalCutoff({ snapshot, team: "NE", targetGameId: "target", targetKickoff }), /not captured before/);
});

test("ratios pool numerators and denominators, EPA sums passing and rushing components", () => {
  const cutoff = applyNflStatisticalCutoff({ snapshot: fixtureSnapshot(), team: "NE", targetGameId: "target", targetKickoff });
  const metrics = aggregateNflTeamProfile(cutoff).seasonBaseline;
  assert.equal(metrics.completion_rate.value, (5 + 21 * 3) / (10 + 30 * 3));
  assert.equal(metrics.passing_yards_per_attempt.value, (100 + 300 * 3) / (10 + 30 * 3));
  assert.equal(metrics.offensive_epa.value, metrics.passing_epa.value! + metrics.rushing_epa.value!);
  assert.equal(metrics.offensive_epa_per_game.value, metrics.offensive_epa.value! / 4);
  assert.equal(metrics.special_teams.field_goal_percentage.value, 3 / 4);
  assert.equal(metrics.special_teams.net_punt_yards_per_punt.value, (25 + 35 * 3) / 4);
});

test("defensive EPA is the opposing offense's EPA and preserves HOME/AWAY orientation", () => {
  const cutoff = applyNflStatisticalCutoff({ snapshot: fixtureSnapshot(), team: "NE", targetGameId: "target", targetKickoff });
  const metrics = aggregateNflTeamProfile(cutoff).seasonBaseline;
  assert.equal(cutoff.teamSide, "HOME");
  assert.equal(metrics.passing_epa_allowed.value, (100 + 0) + (100 + 1) + (100 + 2) + (100 + 3));
  const homeCutoff = applyNflStatisticalCutoff({ snapshot: fixtureSnapshot(), team: "KC", targetGameId: "target", targetKickoff });
  assert.equal(homeCutoff.teamSide, "AWAY");
  assert.equal(homeCutoff.observations.length, 0);
});

test("QB rows remain player stats and are never labeled as starters", () => {
  const cutoff = applyNflStatisticalCutoff({ snapshot: fixtureSnapshot(), team: "NE", targetGameId: "target", targetKickoff });
  const qbs = aggregateNflTeamProfile(cutoff).quarterbacks;
  assert.equal(qbs.length, 2);
  assert.ok(qbs.every((qb) => qb.explicitlyLabeledAsStarter === false));
  assert.ok(qbs.every((qb) => qb.seasonBaseline.passing_epa.snapshotId === "snapshot-2026"));
  const recentQb = qbs.find((qb) => qb.playerId === "qb-new")!;
  assert.deepEqual(recentQb.recentForm.passing_epa.window.gameIds, ["g2", "g3", "g4"]);
  assert.equal(recentQb.recentForm.passing_epa.status, "available");
  assert.equal(qbs.find((qb) => qb.playerId === "qb-old")!.recentForm.passing_epa.status, "insufficient_data");
});

test("explosive components stay separate and turnover rate remains unavailable", () => {
  const cutoff = applyNflStatisticalCutoff({ snapshot: fixtureSnapshot(), team: "NE", targetGameId: "target", targetKickoff });
  const metrics = aggregateNflTeamProfile(cutoff).seasonBaseline;
  assert.equal(metrics.explosive_components.passing_20.value, 4);
  assert.equal(metrics.explosive_components.receiving_20.value, 4);
  assert.equal("explosive_plays_score" in metrics, false);
  assert.equal("turnover_rate" in metrics, false);
  assert.ok(NFL_UNAVAILABLE_METRICS.turnover_rate.includes("denominator"));
});

test("baseline/recent blend is 60/40 and cannot be emitted without all three recent games", () => {
  const cutoff = applyNflStatisticalCutoff({ snapshot: fixtureSnapshot(), team: "NE", targetGameId: "target", targetKickoff });
  const profile = aggregateNflTeamProfile(cutoff);
  const seasonPerGame = profile.seasonBaseline.passing_epa.value! / 4;
  const recentPerGame = profile.recentForm.passing_epa.value! / 3;
  assert.equal(profile.weighted.passing_epa.value, seasonPerGame * 0.6 + recentPerGame * 0.4);
  const weekOneSnapshot = fixtureSnapshot();
  weekOneSnapshot.captured_at = "2026-09-05T20:00:00.000Z";
  const weekOne = applyNflStatisticalCutoff({ snapshot: weekOneSnapshot, team: "NE", targetGameId: "g1", targetKickoff: "2026-09-06T17:00:00.000Z" });
  assert.equal(aggregateNflTeamProfile(weekOne).weighted.passing_epa.status, "insufficient_data");
});
