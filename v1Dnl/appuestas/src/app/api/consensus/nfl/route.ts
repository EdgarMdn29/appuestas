import { NextResponse } from "next/server";
import { calculateNflMarketConsensus, type NflOddsObservation } from "@/lib/nfl/consensus";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedCaptureId = searchParams.get("captureId");
  const nflGameId = searchParams.get("nflGameId");
  if (requestedCaptureId && !validUuid(requestedCaptureId)) {
    return NextResponse.json({ success: false, error: "Invalid captureId" }, { status: 400 });
  }

  try {
    let captureId = requestedCaptureId;
    if (!captureId) {
      const { data, error } = await supabaseAdmin
        .from("nfl_odds_snapshots")
        .select("capture_id")
        .order("captured_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) return NextResponse.json({ success: false, error: "Supabase latest capture query failed", details: error.message }, { status: 500 });
      captureId = data?.capture_id ?? null;
    }
    if (!captureId) {
      return NextResponse.json({ success: true, captureId: null, totalMarkets: 0, consensus: [] });
    }

    const observations: NflOddsObservation[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = supabaseAdmin
        .from("nfl_odds_snapshots")
        .select("capture_id, nfl_game_id, bookmaker_key, bookmaker_title, market, outcome, point, price, captured_at, odds_event_id")
        .eq("capture_id", captureId)
        .order("nfl_game_id", { ascending: true })
        .order("market", { ascending: true })
        .order("point", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (nflGameId) query = query.eq("nfl_game_id", nflGameId);
      const { data, error } = await query;
      if (error) return NextResponse.json({ success: false, error: "Supabase odds query failed", details: error.message }, { status: 500 });
      observations.push(...((data ?? []) as NflOddsObservation[]));
      if (!data || data.length < 1000) break;
    }

    if (requestedCaptureId && observations.length === 0) {
      return NextResponse.json({ success: false, error: "Odds capture not found", captureId }, { status: 404 });
    }
    const consensus = calculateNflMarketConsensus(observations);
    const captureTimestamps = [...new Set(observations.map((row) => row.captured_at))];
    return NextResponse.json({
      success: true,
      captureId,
      capturedAt: captureTimestamps[0] ?? null,
      nflGameId: nflGameId ?? null,
      totalMarkets: consensus.length,
      consensus,
    });
  } catch (error) {
    console.error("NFL market consensus calculation failed:", error);
    return NextResponse.json({ success: false, error: "NFL market consensus calculation failed" }, { status: 500 });
  }
}
