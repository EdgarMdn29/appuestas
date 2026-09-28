import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type MarketKey =
  | "h2h"
  | "h2h_3_way_1st_3_innings"
  | "h2h_3_way_1st_5_innings";

type SnapshotMarket =
  | "FULL_GAME_ML"
  | "F3_3WAY"
  | "F5_3WAY";

type Outcome = "HOME" | "DRAW" | "AWAY";

type OddsApiOutcome = {
  name: string;
  price: number;
};

type OddsApiMarket = {
  key: MarketKey;
  last_update: string;
  outcomes: OddsApiOutcome[];
};

type OddsApiBookmaker = {
  key: string;
  title: string;
  markets: OddsApiMarket[];
};

type OddsApiEvent = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
};

function toISODate(dateStr?: string) {
  if (dateStr) return dateStr;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length);
}

function normalizeOutcome(
  outcomeName: string,
  homeTeam: string,
  awayTeam: string
): Outcome | null {
  if (outcomeName === homeTeam) return "HOME";
  if (outcomeName === awayTeam) return "AWAY";
  if (outcomeName.toLowerCase() === "draw") return "DRAW";

  return null;
}

function normalizeMarket(key: MarketKey): SnapshotMarket | null {
  switch (key) {
    case "h2h":
      return "FULL_GAME_ML";

    case "h2h_3_way_1st_3_innings":
      return "F3_3WAY";

    case "h2h_3_way_1st_5_innings":
      return "F5_3WAY";

    default:
      return null;
  }
}

async function fetchOddsApi<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Odds API request failed: ${response.status} ${response.statusText} - ${body}`
    );
  }

  return response.json();
}

async function fetchFullGameOdds(): Promise<OddsApiEvent[]> {
  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    throw new Error("ODDS_API_KEY is not configured");
  }

  const url =
    "https://api.the-odds-api.com/v4/sports/baseball_mlb/odds" +
    `?regions=us&markets=h2h&oddsFormat=decimal&apiKey=${apiKey}`;

  return fetchOddsApi<OddsApiEvent[]>(url);
}

async function fetchEventThreeWayOdds(
  eventId: string
): Promise<OddsApiEvent> {
  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    throw new Error("ODDS_API_KEY is not configured");
  }

  const url =
    `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds` +
    `?regions=us&markets=h2h_3_way_1st_3_innings,h2h_3_way_1st_5_innings` +
    `&oddsFormat=decimal&apiKey=${apiKey}`;

  return fetchOddsApi<OddsApiEvent>(url);
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

  const snapshotDate = toISODate(
    searchParams.get("date") || undefined
  );

  try {
    /*
     * 1. Get Full Game Moneyline.
     */
    const fullGameEvents = await fetchFullGameOdds();

    /*
     * 2. Get F3/F5 markets for every event returned by Odds API.
     */
    const threeWayResults = await Promise.all(
      fullGameEvents.map(async (event) => {
        try {
          return await fetchEventThreeWayOdds(event.id);
        } catch (error) {
          console.error(
            `Failed to fetch F3/F5 odds for event ${event.id}:`,
            error
          );

          return null;
        }
      })
    );

    /*
     * 3. Build rows for Supabase.
     */
    const rows: Array<{
      snapshot_date: string;
      captured_at: string;
      source: string;
      event_id: string;
      commence_time: string;
      home_team: string;
      away_team: string;
      bookmaker_key: string;
      bookmaker_title: string;
      market: SnapshotMarket;
      outcome: Outcome;
      selection: string;
      price: number;
    }> = [];

    const capturedAt = new Date().toISOString();

    function addEventRows(event: OddsApiEvent) {
      for (const bookmaker of event.bookmakers ?? []) {
        for (const market of bookmaker.markets ?? []) {
          const normalizedMarket = normalizeMarket(market.key);

          if (!normalizedMarket) continue;

          for (const outcome of market.outcomes ?? []) {
            const normalizedOutcome = normalizeOutcome(
              outcome.name,
              event.home_team,
              event.away_team
            );

            if (!normalizedOutcome) continue;

if (outcome.price <= 1) {
  console.log("INVALID ODDS:", {
    event: event.id,
    market: market.key,
    bookmaker: bookmaker.key,
    outcome: outcome.name,
    price: outcome.price,
  });
  continue;
}

            rows.push({
              snapshot_date: snapshotDate,
              captured_at: capturedAt,
              source: "ODDS_API",
              event_id: event.id,
              commence_time: event.commence_time,
              home_team: event.home_team,
              away_team: event.away_team,
              bookmaker_key: bookmaker.key,
              bookmaker_title: bookmaker.title,
              market: normalizedMarket,
              outcome: normalizedOutcome,
              selection: outcome.name,
              price: outcome.price,
            });
          }
        }
      }
    }

    /*
     * Full Game ML.
     */
    for (const event of fullGameEvents) {
      addEventRows(event);
    }

    /*
     * F3/F5.
     */
    for (const event of threeWayResults) {
      if (event) {
        addEventRows(event);
      }
    }

    /*
     * 4. Remove duplicate rows generated by overlapping API responses.
     */
    const uniqueRows = Array.from(
      new Map(
        rows.map((row) => [
          [
            row.event_id,
            row.bookmaker_key,
            row.market,
            row.outcome,
            row.price,
          ].join("|"),
          row,
        ])
      ).values()
    );

    /*
     * 5. Save snapshot rows.
     */
    if (uniqueRows.length > 0) {
      const { error } = await supabaseAdmin
        .from("mlb_odds_snapshots")
        .insert(uniqueRows);

      if (error) {
        throw new Error(
          `Failed to save Odds API snapshot: ${error.message}`
        );
      }
    }

    const marketCounts = uniqueRows.reduce(
      (acc, row) => {
        acc[row.market] = (acc[row.market] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const bookmakerCount = new Set(
      uniqueRows.map((row) => row.bookmaker_key)
    ).size;

    const eventCount = new Set(
      uniqueRows.map((row) => row.event_id)
    ).size;

    return NextResponse.json({
      success: true,
      snapshotDate,
      capturedAt,
      totalEvents: eventCount,
      totalBookmakers: bookmakerCount,
      totalRows: uniqueRows.length,
      marketCounts,
    });
  } catch (error) {
    console.error("Odds API MLB cron error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "MLB Odds API snapshot failed",
        details:
          error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}