import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type MarketType =
  | "F3_3WAY"
  | "F5_3WAY"
  | "FULL_GAME_ML";

type Outcome = "HOME" | "DRAW" | "AWAY";

type OddsRow = {
  event_id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  market: MarketType;
  outcome: Outcome;
  selection: string;
  bookmaker_key: string;
  bookmaker_title: string;
  price: number;
};

type BookmakerOdds = {
  bookmakerKey: string;
  bookmakerTitle: string;
  price: number;
  isHighest: boolean;
  isLowest: boolean;
};

type MarketSelection = {
  outcome: Outcome;
  selection: string;
  marketOdds: number;
  minimumOdds: number;
  maximumOdds: number;
  bookmakers: BookmakerOdds[];
};

type MarketResult = {
  market: MarketType;
  selections: MarketSelection[];
};

type EventResult = {
  eventId: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  markets: MarketResult[];
};

function calculateMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundOdds(value: number): number {
  return Number(value.toFixed(3));
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);

    const snapshotDate =
      requestUrl.searchParams.get("date") ??
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
      }).format(new Date());

    // Find the most recent odds capture for this date.
    const { data: latestCapture, error: latestCaptureError } =
      await supabaseAdmin
        .from("mlb_odds_snapshots")
        .select("captured_at")
        .eq("snapshot_date", snapshotDate)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (latestCaptureError) {
      return NextResponse.json(
        {
          success: false,
          error: "Supabase latest capture query failed",
          details: latestCaptureError.message,
        },
        { status: 500 }
      );
    }

    if (!latestCapture) {
      return NextResponse.json({
        success: true,
        snapshotDate,
        capturedAt: null,
        totalRows: 0,
        totalEvents: 0,
        events: [],
      });
    }

    // Read only the latest capture.
    const { data, error } = await supabaseAdmin
      .from("mlb_odds_snapshots")
      .select(`
        event_id,
        commence_time,
        home_team,
        away_team,
        market,
        outcome,
        selection,
        bookmaker_key,
        bookmaker_title,
        price
      `)
      .eq("snapshot_date", snapshotDate)
      .eq("captured_at", latestCapture.captured_at)
      .order("commence_time", { ascending: true });

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Supabase query failed",
          details: error.message,
        },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as OddsRow[];

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        snapshotDate,
        capturedAt: latestCapture.captured_at,
        totalRows: 0,
        totalEvents: 0,
        events: [],
      });
    }

    const eventsMap = new Map<
      string,
      {
        eventId: string;
        commenceTime: string;
        homeTeam: string;
        awayTeam: string;
        rows: OddsRow[];
      }
    >();

    for (const row of rows) {
      if (!eventsMap.has(row.event_id)) {
        eventsMap.set(row.event_id, {
          eventId: row.event_id,
          commenceTime: row.commence_time,
          homeTeam: row.home_team,
          awayTeam: row.away_team,
          rows: [],
        });
      }

      eventsMap.get(row.event_id)!.rows.push(row);
    }

    const events: EventResult[] = [];

    for (const event of eventsMap.values()) {
      const marketsMap = new Map<string, OddsRow[]>();

      for (const row of event.rows) {
        const key = `${row.market}:${row.outcome}`;

        if (!marketsMap.has(key)) {
          marketsMap.set(key, []);
        }

        marketsMap.get(key)!.push(row);
      }

      const marketGroups = new Map<
        MarketType,
        MarketSelection[]
      >();

      for (const [key, selectionRows] of marketsMap) {
        const [market] = key.split(":") as [MarketType];

        const prices = selectionRows.map((row) =>
          Number(row.price)
        );

        const marketOdds = calculateMedian(prices);
        const minimumOdds = Math.min(...prices);
        const maximumOdds = Math.max(...prices);

        const bookmakers = selectionRows.map((row) => ({
          bookmakerKey: row.bookmaker_key,
          bookmakerTitle: row.bookmaker_title,
          price: Number(row.price),
          isHighest:
            Number(row.price) === maximumOdds,
          isLowest:
            Number(row.price) === minimumOdds,
        }));

        const selection: MarketSelection = {
          outcome: selectionRows[0].outcome,
          selection: selectionRows[0].selection,
          marketOdds: roundOdds(marketOdds),
          minimumOdds: roundOdds(minimumOdds),
          maximumOdds: roundOdds(maximumOdds),
          bookmakers,
        };

        if (!marketGroups.has(market)) {
          marketGroups.set(market, []);
        }

        marketGroups.get(market)!.push(selection);
      }

      const markets: MarketResult[] = [];

      for (const [market, selections] of marketGroups) {
        const outcomeOrder: Record<Outcome, number> = {
          HOME: 1,
          DRAW: 2,
          AWAY: 3,
        };

        selections.sort(
          (a, b) =>
            outcomeOrder[a.outcome] -
            outcomeOrder[b.outcome]
        );

        markets.push({
          market,
          selections,
        });
      }

      const marketOrder: Record<MarketType, number> = {
        F3_3WAY: 1,
        F5_3WAY: 2,
        FULL_GAME_ML: 3,
      };

      markets.sort(
        (a, b) =>
          marketOrder[a.market] -
          marketOrder[b.market]
      );

      events.push({
        eventId: event.eventId,
        commenceTime: event.commenceTime,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        markets,
      });
    }

    return NextResponse.json({
      success: true,
      snapshotDate,
      capturedAt: latestCapture.captured_at,
      totalRows: rows.length,
      totalEvents: events.length,
      events,
    });
  } catch (error) {
    console.error(
      "MLB Market Odds error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error: "Unexpected error",
        details:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      { status: 500 }
    );
  }
}