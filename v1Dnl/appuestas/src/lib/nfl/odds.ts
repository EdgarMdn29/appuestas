import { randomUUID } from "node:crypto";
import type { NflSnapshotPayload } from "@/lib/nfl/types";

export type NflOddsMarket = "MONEYLINE" | "SPREAD" | "TOTAL";
export type NflOddsOutcome = "HOME" | "AWAY" | "OVER" | "UNDER";

type OddsApiOutcome = { name: string; price: number; point?: number };
type OddsApiMarket = { key: string; last_update: string; outcomes: OddsApiOutcome[] };
type OddsApiBookmaker = { key: string; title: string; markets: OddsApiMarket[] };
export type OddsApiEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
};

export type NflSnapshotCandidate = {
  id: string;
  season: number;
  captured_at: string;
  data: NflSnapshotPayload;
};

export type NflOddsInsert = {
  capture_id: string;
  nfl_snapshot_id: string;
  season: number;
  week: number;
  nfl_game_id: string;
  odds_event_id: string;
  commence_time: string;
  captured_at: string;
  market_last_update: string;
  bookmaker_key: string;
  bookmaker_title: string;
  market: NflOddsMarket;
  outcome: NflOddsOutcome;
  point: number | null;
  price: number;
  home_team: string;
  away_team: string;
  source: "ODDS_API";
};

// Keys are canonical nflverse abbreviations; aliases cover common Odds API labels.
const TEAM_ALIASES: Record<string, readonly string[]> = {
  ARI: ["Arizona Cardinals"], ATL: ["Atlanta Falcons"], BAL: ["Baltimore Ravens"],
  BUF: ["Buffalo Bills"], CAR: ["Carolina Panthers"], CHI: ["Chicago Bears"],
  CIN: ["Cincinnati Bengals"], CLE: ["Cleveland Browns"], DAL: ["Dallas Cowboys"],
  DEN: ["Denver Broncos"], DET: ["Detroit Lions"], GB: ["Green Bay Packers"],
  HOU: ["Houston Texans"], IND: ["Indianapolis Colts"], JAX: ["Jacksonville Jaguars", "Jaguars"],
  KC: ["Kansas City Chiefs"], LAC: ["Los Angeles Chargers", "LA Chargers"],
  LAR: ["Los Angeles Rams", "LA Rams", "LA"], LV: ["Las Vegas Raiders"],
  MIA: ["Miami Dolphins"], MIN: ["Minnesota Vikings"], NE: ["New England Patriots"],
  NO: ["New Orleans Saints"], NYG: ["New York Giants"], NYJ: ["New York Jets"],
  PHI: ["Philadelphia Eagles"], PIT: ["Pittsburgh Steelers"],
  SF: ["San Francisco 49ers"], SEA: ["Seattle Seahawks"],
  TB: ["Tampa Bay Buccaneers"], TEN: ["Tennessee Titans"],
  WAS: ["Washington Commanders", "Washington Football Team"],
};

function teamKey(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const TEAM_LOOKUP = new Map<string, string>();
for (const [abbr, aliases] of Object.entries(TEAM_ALIASES)) {
  TEAM_LOOKUP.set(teamKey(abbr), abbr);
  for (const alias of aliases) TEAM_LOOKUP.set(teamKey(alias), abbr);
}

export function normalizeNflTeam(value: unknown): string | null {
  return typeof value === "string" ? TEAM_LOOKUP.get(teamKey(value)) ?? null : null;
}

function timezoneLocalToUtc(dateValue: string, timeValue: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;
  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText, secondText = "0"] = timeMatch;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const [year, month, day, hour, minute, second] = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;

  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let utc = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(utc)).map(({ type, value }) => [type, Number(value)]));
    const represented = Date.UTC(fields.year!, fields.month! - 1, fields.day!, fields.hour!, fields.minute!, fields.second!);
    utc += target - represented;
  }
  const result = new Date(utc);
  const fields = Object.fromEntries(formatter.formatToParts(result).map(({ type, value }) => [type, Number(value)]));
  if (fields.year !== year || fields.month !== month || fields.day !== day || fields.hour !== hour || fields.minute !== minute || fields.second !== second) return null;
  return result.toISOString();
}

export function nflScheduleGameTime(row: Record<string, unknown>): string | null {
  if (typeof row.gameday !== "string" || typeof row.gametime !== "string") return null;
  return timezoneLocalToUtc(row.gameday, row.gametime);
}

type MatchedGame = { snapshot: NflSnapshotCandidate; row: Record<string, unknown>; week: number; gameId: string };

export function matchOddsEvent(event: OddsApiEvent, snapshots: NflSnapshotCandidate[]): MatchedGame | null {
  const home = normalizeNflTeam(event.home_team);
  const away = normalizeNflTeam(event.away_team);
  const eventTime = Date.parse(event.commence_time);
  if (!home || !away || !Number.isFinite(eventTime)) return null;

  const matches: MatchedGame[] = [];
  for (const snapshot of snapshots) {
    const latest = snapshot;
    for (const candidate of latest.data.schedule.rows) {
      const row = candidate as Record<string, unknown>;
      if (normalizeNflTeam(row.home_team) !== home || normalizeNflTeam(row.away_team) !== away) continue;
      const gameTime = nflScheduleGameTime(row);
      if (!gameTime || Math.abs(Date.parse(gameTime) - eventTime) > 15 * 60 * 1000) continue;
      if (row.season !== snapshot.season || typeof row.week !== "number" || !Number.isInteger(row.week) || typeof row.game_id !== "string" || !row.game_id) continue;
      matches.push({ snapshot: latest, row, week: row.week, gameId: row.game_id });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export function buildNflOddsRows(
  events: OddsApiEvent[],
  snapshots: NflSnapshotCandidate[],
  capturedAt = new Date().toISOString(),
  captureId = randomUUID(),
  log: (message: string) => void = console.warn,
): { captureId: string; capturedAt: string; rows: NflOddsInsert[]; unmatched: string[] } {
  const rows: NflOddsInsert[] = [];
  const unmatched: string[] = [];
  for (const event of events) {
    const match = matchOddsEvent(event, snapshots);
    if (!match) {
      unmatched.push(event.id);
      log(`NFL Odds API event unmatched or ambiguous: ${event.id} (${event.away_team} at ${event.home_team}, ${event.commence_time})`);
      continue;
    }
    const homeTeam = normalizeNflTeam(event.home_team)!;
    const awayTeam = normalizeNflTeam(event.away_team)!;
    for (const bookmaker of event.bookmakers ?? []) {
      if (!bookmaker.key || !bookmaker.title) continue;
      for (const market of bookmaker.markets ?? []) {
        const marketType: NflOddsMarket | null = market.key === "h2h" ? "MONEYLINE" : market.key === "spreads" ? "SPREAD" : market.key === "totals" ? "TOTAL" : null;
        if (!marketType) continue;
        const marketLastUpdate = Date.parse(market.last_update);
        if (!Number.isFinite(marketLastUpdate)) continue;
        for (const outcome of market.outcomes ?? []) {
          const price = Number(outcome.price);
          if (!Number.isFinite(price) || price <= 1) continue;
          let normalizedOutcome: NflOddsOutcome | null = null;
          let point: number | null = null;
          if (marketType === "TOTAL") {
            const side = outcome.name.toLowerCase();
            if (side === "over") normalizedOutcome = "OVER";
            if (side === "under") normalizedOutcome = "UNDER";
            if (typeof outcome.point === "number" && Number.isFinite(outcome.point)) point = outcome.point;
          } else {
            const side = normalizeNflTeam(outcome.name);
            if (side === homeTeam) normalizedOutcome = "HOME";
            if (side === awayTeam) normalizedOutcome = "AWAY";
            if (marketType === "SPREAD" && typeof outcome.point === "number" && Number.isFinite(outcome.point)) point = outcome.point;
          }
          if (!normalizedOutcome || (marketType === "MONEYLINE" ? point !== null : point === null)) continue;
          rows.push({
            capture_id: captureId,
            nfl_snapshot_id: match.snapshot.id,
            season: match.snapshot.season,
            week: match.week,
            nfl_game_id: match.gameId,
            odds_event_id: event.id,
            commence_time: new Date(event.commence_time).toISOString(),
            captured_at: capturedAt,
            market_last_update: new Date(marketLastUpdate).toISOString(),
            bookmaker_key: bookmaker.key,
            bookmaker_title: bookmaker.title,
            market: marketType,
            outcome: normalizedOutcome,
            point,
            price,
            home_team: event.home_team,
            away_team: event.away_team,
            source: "ODDS_API",
          });
        }
      }
    }
  }

  const unique = new Map<string, NflOddsInsert>();
  for (const row of rows) {
    const key = [row.odds_event_id, row.bookmaker_key, row.market, row.outcome, row.point ?? "NULL"].join("|");
    unique.set(key, row);
  }
  return { captureId, capturedAt, rows: [...unique.values()], unmatched };
}
