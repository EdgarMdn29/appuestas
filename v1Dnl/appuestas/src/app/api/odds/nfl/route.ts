import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type OddsRow = {
  id: string;
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
  market: "MONEYLINE" | "SPREAD" | "TOTAL";
  outcome: "HOME" | "AWAY" | "OVER" | "UNDER";
  point: number | null;
  price: number;
  home_team: string;
  away_team: string;
  source: string;
};

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const captureId = searchParams.get("captureId");
  const nflGameId = searchParams.get("nflGameId");
  const oddsEventId = searchParams.get("oddsEventId");
  const date = searchParams.get("date");
  if (captureId && !validUuid(captureId)) return NextResponse.json({ error: "Invalid captureId" }, { status: 400 });
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date must use YYYY-MM-DD" }, { status: 400 });

  try {
    let selectedCapture = captureId;
    if (!selectedCapture) {
      let latestQuery = supabaseAdmin.from("nfl_odds_snapshots").select("capture_id").order("captured_at", { ascending: false }).limit(1);
      if (nflGameId) latestQuery = latestQuery.eq("nfl_game_id", nflGameId);
      if (oddsEventId) latestQuery = latestQuery.eq("odds_event_id", oddsEventId);
      if (date) {
        const from = new Date(`${date}T00:00:00.000Z`);
        if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== date) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
        const until = new Date(from.getTime() + 24 * 60 * 60 * 1000);
        latestQuery = latestQuery.gte("commence_time", from.toISOString()).lt("commence_time", until.toISOString());
      }
      const { data, error } = await latestQuery.maybeSingle();
      if (error) return NextResponse.json({ error: "Supabase latest capture query failed", details: error.message }, { status: 500 });
      selectedCapture = data?.capture_id ?? null;
    }
    if (!selectedCapture) return NextResponse.json({ success: true, captureId: null, capturedAt: null, totalRows: 0, totalEvents: 0, events: [] });

    const baseQuery = () => supabaseAdmin.from("nfl_odds_snapshots").select("*").eq("capture_id", selectedCapture).order("commence_time", { ascending: true }).order("id", { ascending: true });
    let filterQuery = baseQuery();
    if (nflGameId) filterQuery = filterQuery.eq("nfl_game_id", nflGameId);
    if (oddsEventId) filterQuery = filterQuery.eq("odds_event_id", oddsEventId);
    if (date) {
      const from = new Date(`${date}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== date) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      filterQuery = filterQuery.gte("commence_time", from.toISOString()).lt("commence_time", new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString());
    }
    const rows: OddsRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await filterQuery.range(offset, offset + 999);
      if (error) return NextResponse.json({ error: "Supabase odds query failed", details: error.message }, { status: 500 });
      rows.push(...((data ?? []) as OddsRow[]));
      if (!data || data.length < 1000) break;
    }
    if (captureId && rows.length === 0) return NextResponse.json({ error: "Odds capture not found", captureId }, { status: 404 });

    const events = new Map<string, { eventId: string; nflSnapshotId: string; nflGameId: string; season: number; week: number; commenceTime: string; homeTeam: string; awayTeam: string; capturedAt: string; bookmakers: Map<string, { key: string; title: string; markets: Map<string, { market: string; outcomes: Array<{ outcome: string; point: number | null; price: number; marketLastUpdate: string }> }> }> }>();
    for (const row of rows) {
      let event = events.get(row.odds_event_id);
      if (!event) {
        event = { eventId: row.odds_event_id, nflSnapshotId: row.nfl_snapshot_id, nflGameId: row.nfl_game_id, season: row.season, week: row.week, commenceTime: row.commence_time, homeTeam: row.home_team, awayTeam: row.away_team, capturedAt: row.captured_at, bookmakers: new Map() };
        events.set(row.odds_event_id, event);
      }
      let bookmaker = event.bookmakers.get(row.bookmaker_key);
      if (!bookmaker) {
        bookmaker = { key: row.bookmaker_key, title: row.bookmaker_title, markets: new Map() };
        event.bookmakers.set(row.bookmaker_key, bookmaker);
      }
      let market = bookmaker.markets.get(row.market);
      if (!market) {
        market = { market: row.market, outcomes: [] };
        bookmaker.markets.set(row.market, market);
      }
      market.outcomes.push({ outcome: row.outcome, point: row.point, price: Number(row.price), marketLastUpdate: row.market_last_update });
    }
    const formattedEvents = [...events.values()].map((event) => ({
      eventId: event.eventId,
      nflSnapshotId: event.nflSnapshotId,
      nflGameId: event.nflGameId,
      season: event.season,
      week: event.week,
      commenceTime: event.commenceTime,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      capturedAt: event.capturedAt,
      bookmakers: [...event.bookmakers.values()].map((bookmaker) => ({
        key: bookmaker.key,
        title: bookmaker.title,
        markets: [...bookmaker.markets.values()],
      })),
    }));
    return NextResponse.json({ success: true, captureId: selectedCapture, capturedAt: rows[0]?.captured_at ?? null, totalRows: rows.length, totalEvents: formattedEvents.length, events: formattedEvents });
  } catch (error) {
    console.error("NFL odds query failed:", error);
    return NextResponse.json({ error: "Unexpected NFL odds query error" }, { status: 500 });
  }
}
