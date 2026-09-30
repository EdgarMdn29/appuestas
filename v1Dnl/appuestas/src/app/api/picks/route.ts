import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { saveHistoricalPick } from "@/lib/performance/picks";

type BetPickRequest = {
  sport: "MLB";
  event_id: string;
  event_date: string;
  home_team: string;
  away_team: string;
  market: string;
  selection: string;
  odds: number;
  estimated_probability: number;
  implied_probability: number;
  edge: number;
  ev: number;
  confidence: number;
  grade: string;
  decision: "BET";
  units: number;
  phase: "REGULAR_SEASON" | "PLAYOFFS";
  model_version: string;
  prompt_version: string;
  config_version: string;
};

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<BetPickRequest>;

    if (body.sport !== "MLB" || body.decision !== "BET") {
      return NextResponse.json(
        { success: false, error: "Only accepted MLB BET picks can be saved." },
        { status: 400 },
      );
    }

    const requiredStrings = [
      "event_id", "event_date", "home_team", "away_team", "market",
      "selection", "grade", "phase", "model_version", "prompt_version", "config_version",
    ] as const;

    for (const field of requiredStrings) {
      if (typeof body[field] !== "string" || !body[field]) {
        return NextResponse.json(
          { success: false, error: `Missing field: ${field}` },
          { status: 400 },
        );
      }
    }

    const numericFields = [
      "odds", "estimated_probability", "implied_probability", "edge", "ev", "confidence", "units",
    ] as const;

    for (const field of numericFields) {
      if (!isNumber(body[field])) {
        return NextResponse.json(
          { success: false, error: `Invalid numeric field: ${field}` },
          { status: 400 },
        );
      }
    }

    if ((body.odds ?? 0) <= 1) {
      return NextResponse.json({ success: false, error: "Odds must be greater than 1." }, { status: 400 });
    }

    if ((body.estimated_probability ?? -1) < 0 || (body.estimated_probability ?? 2) > 1) {
      return NextResponse.json({ success: false, error: "Estimated probability must be between 0 and 1." }, { status: 400 });
    }

    if ((body.implied_probability ?? -1) < 0 || (body.implied_probability ?? 2) > 1) {
      return NextResponse.json({ success: false, error: "Implied probability must be between 0 and 1." }, { status: 400 });
    }

    if ((body.confidence ?? -1) < 0 || (body.confidence ?? 101) > 100) {
      return NextResponse.json({ success: false, error: "Confidence must be between 0 and 100." }, { status: 400 });
    }

    const { data: existingPick, error: existingPickError } = await supabaseAdmin
      .from("betting_picks")
      .select("id")
      .eq("event_id", body.event_id!)
      .eq("event_date", body.event_date!)
      .eq("market", body.market!)
      .eq("selection", body.selection!)
      .eq("result", "PENDING")
      .limit(1)
      .maybeSingle();

    if (existingPickError) {
      throw existingPickError;
    }

    if (existingPick) {
      return NextResponse.json(
        { success: false, error: "This pick is already saved." },
        { status: 409 },
      );
    }

    const pick = await saveHistoricalPick({
      sport: "MLB",
      event_id: body.event_id!,
      event_date: body.event_date!,
      home_team: body.home_team!,
      away_team: body.away_team!,
      market: body.market!,
      selection: body.selection!,
      odds: body.odds!,
      estimated_probability: body.estimated_probability!,
      implied_probability: body.implied_probability!,
      edge: body.edge!,
      ev: body.ev!,
      confidence: body.confidence!,
      grade: body.grade!,
      decision: "BET",
      units: body.units!,
      result: "PENDING",
      is_parlay: false,
      parlay_id: null,
      phase: body.phase,
      model_version: body.model_version!,
      prompt_version: body.prompt_version!,
      config_version: body.config_version!,
    });

    return NextResponse.json({ success: true, pick });
  } catch (error) {
    console.error("Save MLB bet error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unable to save bet." },
      { status: 500 },
    );
  }
}
