import { NextResponse } from "next/server";
import { getDefaultNflSeason, isValidNflSeason } from "@/lib/nfl/nflverse";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { NflSnapshotRecord } from "@/lib/nfl/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const snapshotId = searchParams.get("snapshotId");
  const season = Number(searchParams.get("season") ?? getDefaultNflSeason());

  if (snapshotId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId)) {
    return NextResponse.json({ error: "Invalid snapshotId" }, { status: 400 });
  }

  if (!snapshotId && !isValidNflSeason(season)) {
    return NextResponse.json({ error: "Invalid NFL season" }, { status: 400 });
  }

  let query = supabaseAdmin
    .from("nfl_snapshots")
    .select("id, season, captured_at, source, source_version, sha256, data");
  query = snapshotId
    ? query.eq("id", snapshotId)
    : query.eq("season", season).order("captured_at", { ascending: false }).limit(1);

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("Error reading NFL snapshot:", error.message);
    return NextResponse.json({ error: "Snapshot database error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "NFL snapshot not available", season }, { status: 404 });
  }

  const snapshot = data as NflSnapshotRecord;
  return NextResponse.json({
    league: "nfl",
    season: snapshot.season,
    matches: snapshot.data.schedule.rows,
    totalMatches: snapshot.data.schedule.rowCount,
    source: snapshot.source,
    snapshot: {
      id: snapshot.id,
      capturedAt: snapshot.captured_at,
      sourceVersion: snapshot.source_version,
      sha256: snapshot.sha256,
    },
  });
}
