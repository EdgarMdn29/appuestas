import { createHash } from "node:crypto";
import type { NflSnapshotPayload, NflverseDataset, NflverseRow } from "@/lib/nfl/types";

const BASE_URL = "https://github.com/nflverse/nflverse-data/releases/download";
const SCHEDULE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const REQUEST_TIMEOUT_MS = 30_000;

/** Parse RFC 4180 CSV, including quoted commas, escaped quotes and newlines. */
export function parseNflverseCsv(csv: string): NflverseRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      record.push(field);
      field = "";
      if (record.some((value) => value.length > 0)) records.push(record);
      record = [];
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("Malformed nflverse CSV: unterminated quoted field");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    if (record.some((value) => value.length > 0)) records.push(record);
  }
  if (records.length < 2) throw new Error("nflverse CSV contains no data rows");

  const headers = records[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error("nflverse CSV contains an empty column name");

  return records.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`Malformed nflverse CSV row ${rowIndex + 2}: expected ${headers.length} columns, received ${values.length}`);
    }

    return Object.fromEntries(headers.map((header, index) => [header, parseValue(values[index])]));
  });
}

function parseValue(value: string): string | number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "NA" || trimmed === "N/A") return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  return trimmed;
}

async function fetchCsv(url: string, season?: number): Promise<NflverseDataset> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "User-Agent": "Appuestas-NFL-V1/1.0" },
  });
  if (!response.ok) throw new Error(`nflverse request failed (${response.status}) for ${url}`);

  const rows = parseNflverseCsv(await response.text());
  const filtered = season === undefined
    ? rows
    : rows.filter((row) => Number(row.season) === season);
  return {
    url,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    rowCount: filtered.length,
    rows: filtered,
  };
}

export function isValidNflSeason(season: number): boolean {
  return Number.isInteger(season) && season >= 1999 && season <= new Date().getUTCFullYear() + 1;
}

export function getDefaultNflSeason(date = new Date()): number {
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 7 ? year : year - 1;
}

function requireIntegerField(row: NflverseRow, field: string, label: string) {
  const value = row[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} contains an invalid ${field} value`);
  }
}

function validateSchedule(schedule: NflverseDataset, season: number) {
  if (!schedule.rowCount) throw new Error(`nflverse returned no schedule rows for ${season}`);

  for (const row of schedule.rows) {
    requireIntegerField(row, "season", "Schedule");
    requireIntegerField(row, "week", "Schedule");
    if (row.season !== season) throw new Error(`Schedule contains a row outside requested season ${season}`);
    if (typeof row.game_type !== "string" || !row.game_type) {
      throw new Error("Schedule contains a row without game_type");
    }
  }
}

function validateStats(dataset: NflverseDataset, name: string, season: number) {
  if (!dataset.rowCount) throw new Error(`nflverse returned no ${name} rows for ${season}`);

  for (const row of dataset.rows) {
    requireIntegerField(row, "season", name);
    requireIntegerField(row, "week", name);
    if (row.season !== season) throw new Error(`${name} contains a row outside requested season ${season}`);
    if (typeof row.season_type !== "string" || !row.season_type) {
      throw new Error(`${name} contains a row without season_type`);
    }
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function canonicalRows(dataset: NflverseDataset): NflverseRow[] {
  return [...dataset.rows].sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function hashNflContent(
  season: number,
  schedule: NflverseDataset,
  teamStats: NflverseDataset,
  playerStats: NflverseDataset,
) {
  const content = {
    league: "nfl",
    season,
    schedule: canonicalRows(schedule),
    teamStats: canonicalRows(teamStats),
    playerStats: canonicalRows(playerStats),
  };
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

export async function loadNflverseSeason(season: number): Promise<NflSnapshotPayload> {
  if (!isValidNflSeason(season)) throw new Error("Season must be a valid NFL season from 1999 onward");

  const teamStatsUrl = `${BASE_URL}/stats_team/stats_team_week_${season}.csv`;
  const playerStatsUrl = `${BASE_URL}/stats_player/stats_player_week_${season}.csv`;
  const [schedule, teamStats, playerStats] = await Promise.all([
    fetchCsv(SCHEDULE_URL, season),
    fetchCsv(teamStatsUrl),
    fetchCsv(playerStatsUrl),
  ]);

  validateSchedule(schedule, season);
  validateStats(teamStats, "Team stats", season);
  validateStats(playerStats, "Player stats", season);

  const capturedAt = new Date().toISOString();
  const sourceVersion = hashNflContent(season, schedule, teamStats, playerStats);

  return { league: "nfl", season, capturedAt, source: "nflverse", sourceVersion, schedule, teamStats, playerStats };
}

export function hashNflSnapshot(payload: NflSnapshotPayload): string {
  return hashNflContent(payload.season, payload.schedule, payload.teamStats, payload.playerStats);
}
