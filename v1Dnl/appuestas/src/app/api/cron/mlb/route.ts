import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type SnapshotSlot = "09" | "14" | "17";

type MlbGame = {
  id: string;
  date: string;
  startDateTimeUtc: string;
  homeTeam: {
    id: number;
    name: string;
    logo: string;
    score: number | null;
  };
  awayTeam: {
    id: number;
    name: string;
    logo: string;
    score: number | null;
  };
  pitchers: {
    home: MlbPitcher | null;
    away: MlbPitcher | null;
  };
  status: string;
  time: string;
};

type MlbPitcher = {
  id: number;
  name: string;
  stats: {
    era: string | null;
    whip: string | null;
    wins: number | null;
    losses: number | null;
  };
};

type SnapshotData = {
  league: "mlb";
  date: string;
  totalMatches: number;
  matches: MlbGame[];
};

function isValidSlot(value: string | null): value is SnapshotSlot {
  return value === "09" || value === "14" || value === "17";
}

function toISODate(dateStr?: string) {
  if (dateStr) {
    return dateStr;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatMexicoCityTime(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateString));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `MLB API request failed: ${response.status} ${response.statusText} - ${url}`
    );
  }

  return response.json();
}

async function fetchPitcher(
  pitcherId: number,
  pitcherName: string
): Promise<MlbPitcher> {
  const data = await fetchJson<any>(
    `https://statsapi.mlb.com/api/v1/people/${pitcherId}?hydrate=stats(group=[pitching],type=[season])`
  );

  const person = data.people?.[0];

  const stats = person?.stats?.[0]?.splits?.[0]?.stat;

  return {
    id: pitcherId,
    name: pitcherName,
    stats: {
      era: stats?.era ?? null,
      whip: stats?.whip ?? null,
      wins: stats?.wins ?? null,
      losses: stats?.losses ?? null,
    },
  };
}

async function fetchGame(gamePk: number, scheduledGame: any): Promise<MlbGame> {
  const gameData = await fetchJson<any>(
    `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`
  );

  const game = gameData.gameData;
  const live = gameData.liveData;

  const homeTeam = game.teams?.home;
  const awayTeam = game.teams?.away;

  const homePitcherId =
    live?.boxscore?.teams?.home?.pitchers?.[0] ??
    game?.probablePitchers?.home?.id;

  const awayPitcherId =
    live?.boxscore?.teams?.away?.pitchers?.[0] ??
    game?.probablePitchers?.away?.id;

  const homePitcherName =
    game?.probablePitchers?.home?.fullName ??
    game?.probablePitchers?.home?.name ??
    null;

  const awayPitcherName =
    game?.probablePitchers?.away?.fullName ??
    game?.probablePitchers?.away?.name ??
    null;

  const [homePitcher, awayPitcher] = await Promise.all([
    homePitcherId && homePitcherName
      ? fetchPitcher(homePitcherId, homePitcherName)
      : Promise.resolve(null),

    awayPitcherId && awayPitcherName
      ? fetchPitcher(awayPitcherId, awayPitcherName)
      : Promise.resolve(null),
  ]);

  const status =
    game?.status?.detailedState ??
    scheduledGame?.status?.detailedState ??
    "Unknown";

  const startDateTimeUtc =
    game?.datetime?.dateTime ??
    scheduledGame?.gameDate ??
    new Date().toISOString();

  return {
    id: String(gamePk),
    date: scheduledGame?.gameDate
      ? toISODate(scheduledGame.gameDate)
      : toISODate(),
    startDateTimeUtc,

    homeTeam: {
      id: homeTeam?.id,
      name: homeTeam?.name ?? "Unknown",
      logo: homeTeam?.id
        ? `https://www.mlbstatic.com/team-logos/${homeTeam.id}.svg`
        : "",
      score: live?.linescore?.teams?.home?.runs ?? null,
    },

    awayTeam: {
      id: awayTeam?.id,
      name: awayTeam?.name ?? "Unknown",
      logo: awayTeam?.id
        ? `https://www.mlbstatic.com/team-logos/${awayTeam.id}.svg`
        : "",
      score: live?.linescore?.teams?.away?.runs ?? null,
    },

    pitchers: {
      home: homePitcher,
      away: awayPitcher,
    },

    status,

    time: formatMexicoCityTime(startDateTimeUtc),
  };
}

async function getPreviousSnapshot(
  date: string,
  slot: SnapshotSlot
): Promise<SnapshotData | null> {
  const previousSlot: SnapshotSlot | null =
    slot === "17" ? "14" : slot === "14" ? "09" : null;

  if (!previousSlot) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("mlb_snapshots")
    .select("data")
    .eq("snapshot_date", date)
    .eq("snapshot_slot", previousSlot)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read previous snapshot: ${error.message}`);
  }

  if (!data?.data) {
    return null;
  }

  return data.data as SnapshotData;
}

function isFinal(game: MlbGame | undefined): game is MlbGame {
  if (!game) {
    return false;
  }

  return game.status.toLowerCase() === "final";
}

function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length);
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      {
        success: false,
        error: "CRON_SECRET is not configured",
      },
      { status: 500 }
    );
  }

  const providedToken = getBearerToken(req);

  if (!providedToken || providedToken !== cronSecret) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
      },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);

  const date = toISODate(searchParams.get("date") || undefined);
  const requestedSlot = searchParams.get("slot");

  if (!isValidSlot(requestedSlot)) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid slot",
        message: "slot must be one of: 09, 14, 17",
      },
      { status: 400 }
    );
  }

  const slot = requestedSlot;

  try {
    /*
     * 1. Get the MLB schedule for the requested date.
     */
    const scheduleUrl =
      `https://statsapi.mlb.com/api/v1/schedule` +
      `?sportId=1&date=${date}`;

    const scheduleData = await fetchJson<any>(scheduleUrl);

    const scheduledGames =
      scheduleData.dates?.flatMap((dateEntry: any) => dateEntry.games ?? []) ??
      [];

    /*
     * 2. Read the previous snapshot.
     *
     * This allows us to freeze games that were already FINAL.
     */
    const previousSnapshot = await getPreviousSnapshot(date, slot);

    const previousMatches = new Map<string, MlbGame>();

    previousSnapshot?.matches?.forEach((match) => {
      previousMatches.set(match.id, match);
    });

    /*
     * 3. Build the new snapshot.
     */
    const matches: MlbGame[] = [];

    let reusedFinalMatches = 0;
    let refreshedMatches = 0;

    for (const scheduledGame of scheduledGames) {
      const gameId = String(scheduledGame.gamePk);

      const previousMatch = previousMatches.get(gameId);

      /*
       * If the previous snapshot already had this game as FINAL,
       * keep it exactly as it was.
       */
      if (isFinal(previousMatch)) {
        matches.push(previousMatch);
        reusedFinalMatches++;
        continue;
      }

      /*
       * Otherwise query MLB for the latest state.
       */
      const match = await fetchGame(
        scheduledGame.gamePk,
        scheduledGame
      );

      matches.push(match);
      refreshedMatches++;
    }

    const snapshot: SnapshotData = {
      league: "mlb",
      date,
      totalMatches: matches.length,
      matches,
    };

    /*
     * 4. Save the snapshot.
     *
     * Upsert makes the cron idempotent if the same slot is executed again.
     */
    const { data: savedSnapshot, error: saveError } = await supabaseAdmin
      .from("mlb_snapshots")
      .upsert(
        {
          snapshot_date: date,
          snapshot_slot: slot,
          captured_at: new Date().toISOString(),
          source: "MLB_STATS_API",
          data: snapshot,
        },
        {
          onConflict: "snapshot_date,snapshot_slot",
        }
      )
      .select("id, snapshot_date, snapshot_slot, captured_at")
      .single();

    if (saveError) {
      throw new Error(
        `Failed to save MLB snapshot: ${saveError.message}`
      );
    }

    return NextResponse.json({
      success: true,
      message: "MLB snapshot created successfully",
      date,
      slot,
      totalMatches: matches.length,
      reusedFinalMatches,
      refreshedMatches,
      snapshot: savedSnapshot,
    });
  } catch (error) {
    console.error("MLB cron error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "MLB snapshot generation failed",
        details:
          error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}