import { NextResponse } from "next/server";
import { buildNflGameContext } from "@/lib/nfl/context/engine";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { NflSnapshotRecord } from "@/lib/nfl/types";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const snapshotId = searchParams.get("snapshotId")?.trim();
  const gameId = searchParams.get("gameId")?.trim();
  const kickoff = searchParams.get("kickoff")?.trim();

  if (!snapshotId || !UUID_PATTERN.test(snapshotId)) {
    return NextResponse.json({ error: "A valid snapshotId is required" }, { status: 400 });
  }
  if (!gameId || !kickoff) {
    return NextResponse.json({ error: "gameId and kickoff are required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("nfl_snapshots")
    .select("id, season, captured_at, source, source_version, sha256, data")
    .eq("id", snapshotId)
    .maybeSingle();

  if (error) {
    console.error("Error reading NFL context snapshot:", error.message);
    return NextResponse.json({ error: "Snapshot database error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "NFL snapshot not found", snapshotId }, { status: 404 });

  try {
    const context = buildNflGameContext({ snapshot: data as NflSnapshotRecord, gameId, kickoff });
    return NextResponse.json(context);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Invalid NFL context request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
