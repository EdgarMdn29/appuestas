import { NextResponse } from "next/server";
import { buildNflOddsRows, type NflSnapshotCandidate, type OddsApiEvent } from "@/lib/nfl/odds";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
}

async function fetchNflOdds(): Promise<OddsApiEvent[]> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("ODDS_API_KEY is not configured");
  const url = new URL("https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds");
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h,spreads,totals");
  url.searchParams.set("oddsFormat", "decimal");
  url.searchParams.set("apiKey", apiKey);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Odds API request failed (${response.status} ${response.statusText}): ${details}`);
  }
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Odds API returned an invalid event list");
  return payload as OddsApiEvent[];
}

async function loadLatestNflSnapshots(year: number): Promise<NflSnapshotCandidate[]> {
  const seasons = [...new Set([year - 1, year, year + 1])].filter((season) => season >= 1999);
  const results = await Promise.all(seasons.map((season) =>
    supabaseAdmin
      .from("nfl_snapshots")
      .select("id, season, captured_at, data")
      .eq("season", season)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ));
  const failure = results.find((result) => result.error);
  if (failure?.error) throw new Error(`Failed to read NFL snapshots: ${failure.error.message}`);
  return results.flatMap(({ data }) => data ? [data as unknown as NflSnapshotCandidate] : []);
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ success: false, error: "CRON_SECRET is not configured" }, { status: 500 });
  if (getBearerToken(request) !== cronSecret) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  try {
    const snapshots = await loadLatestNflSnapshots(new Date().getUTCFullYear());
    if (snapshots.length === 0) {
      return NextResponse.json({ success: false, error: "No NFL schedule snapshots are available" }, { status: 503 });
    }
    const events = await fetchNflOdds();
    const capture = buildNflOddsRows(events, snapshots, new Date().toISOString());

    if (capture.rows.length > 0) {
      const { error } = await supabaseAdmin.from("nfl_odds_snapshots").insert(capture.rows);
      if (error) throw new Error(`Failed to save NFL odds snapshot: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      capture_id: capture.captureId,
      captured_at: capture.capturedAt,
      total_events: new Set(capture.rows.map((row) => row.odds_event_id)).size,
      unmatched_events: capture.unmatched.length,
      total_bookmakers: new Set(capture.rows.map((row) => row.bookmaker_key)).size,
      total_rows: capture.rows.length,
      markets: capture.rows.reduce((counts, row) => ({ ...counts, [row.market]: (counts[row.market] ?? 0) + 1 }), {} as Record<string, number>),
    });
  } catch (error) {
    console.error("NFL odds snapshot capture failed:", error);
    return NextResponse.json({ success: false, error: "NFL odds snapshot capture failed", details: error instanceof Error ? error.message : "Unknown error" }, { status: 502 });
  }
}
