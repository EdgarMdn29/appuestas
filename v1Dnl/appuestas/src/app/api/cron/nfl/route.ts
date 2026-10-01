import { NextResponse } from "next/server";
import { getDefaultNflSeason, hashNflSnapshot, isValidNflSeason, loadNflverseSeason } from "@/lib/nfl/nflverse";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ success: false, error: "CRON_SECRET is not configured" }, { status: 500 });
  if (getBearerToken(request) !== cronSecret) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const season = Number(searchParams.get("season") ?? getDefaultNflSeason());
  if (!isValidNflSeason(season)) return NextResponse.json({ success: false, error: "Invalid NFL season" }, { status: 400 });

  try {
    const snapshot = await loadNflverseSeason(season);
    const sha256 = hashNflSnapshot(snapshot);
    const { data, error } = await supabaseAdmin
      .from("nfl_snapshots")
      .insert({ season, source: "nflverse", source_version: snapshot.sourceVersion, sha256, data: snapshot })
      .select("id, season, captured_at, source, source_version, sha256")
      .single();

    if (error) throw new Error(`Failed to save NFL snapshot: ${error.message}`);
    return NextResponse.json({ success: true, snapshot: data, rows: {
      schedule: snapshot.schedule.rowCount,
      teamStats: snapshot.teamStats.rowCount,
      playerStats: snapshot.playerStats.rowCount,
    } });
  } catch (error) {
    console.error("NFL snapshot capture failed:", error);
    return NextResponse.json({ success: false, error: "NFL snapshot capture failed" }, { status: 502 });
  }
}
