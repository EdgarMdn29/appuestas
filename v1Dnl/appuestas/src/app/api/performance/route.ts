import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const SPORTS = new Set(["MLB", "NFL"]);
const PERIODS = new Set(["7d", "30d", "all"]);

type PerformanceRow = {
  id: string;
  sport: "MLB" | "NFL";
  event_id: string;
  event_date: string;
  created_at: string;
  home_team: string | null;
  away_team: string | null;
  market: string;
  selection: string;
  odds: number;
  estimated_probability: number;
  implied_probability: number;
  edge: number;
  ev: number;
  confidence: number;
  grade: string;
  decision: "BET" | "NO BET";
  units: number;
  result: "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
  settled_at: string | null;
  is_parlay: boolean;
  parlay_id: string | null;
  phase: "REGULAR_SEASON" | "PLAYOFFS" | null;
  model_version: string;
  prompt_version: string;
  config_version: string;
};

function getStartDate(period: string): string | null {
  if (period === "all") return null;

  const days = period === "7d" ? 6 : 29;
  const date = new Date();
  date.setDate(date.getDate() - days);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") ?? "7d";
    const sport = searchParams.get("sport") ?? "COMBINED";

    if (!PERIODS.has(period)) {
      return NextResponse.json(
        { success: false, error: "Invalid period." },
        { status: 400 },
      );
    }

    if (sport !== "COMBINED" && !SPORTS.has(sport)) {
      return NextResponse.json(
        { success: false, error: "Invalid sport." },
        { status: 400 },
      );
    }

    let query = supabaseAdmin
      .from("betting_picks")
      .select(
        "id, sport, event_id, event_date, created_at, home_team, away_team, market, selection, odds, estimated_probability, implied_probability, edge, ev, confidence, grade, decision, units, result, settled_at, is_parlay, parlay_id, phase, model_version, prompt_version, config_version",
      )
      .eq("decision", "BET")
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false });

    const startDate = getStartDate(period);
    if (startDate) {
      query = query.gte("event_date", startDate);
    }

    if (sport !== "COMBINED") {
      query = query.eq("sport", sport);
    }

    const { data, error } = await query;

    if (error) {
      const message = error.message ?? "Performance query failed.";
      const tableMissing =
        message.includes("betting_picks") &&
        (message.includes("does not exist") || message.includes("relation"));

      if (tableMissing) {
        return NextResponse.json({
          success: true,
          tableReady: false,
          period,
          sport,
          metrics: null,
          picks: [],
        });
      }

      throw error;
    }

    const picks = (data ?? []) as PerformanceRow[];
    const settled = picks.filter((pick) =>
      ["WIN", "LOSS", "PUSH"].includes(pick.result),
    );
    const wins = settled.filter((pick) => pick.result === "WIN").length;
    const losses = settled.filter((pick) => pick.result === "LOSS").length;
    const pushes = settled.filter((pick) => pick.result === "PUSH").length;
    const units = settled.reduce((sum, pick) => sum + Number(pick.units ?? 0), 0);
    const winsAndLosses = wins + losses;

    const avgOdds = picks.length
      ? picks.reduce((sum, pick) => sum + Number(pick.odds), 0) / picks.length
      : 0;

    const roiBase = settled.reduce(
      (sum, pick) => sum + Math.abs(Number(pick.units ?? 0)),
      0,
    );

    return NextResponse.json({
      success: true,
      tableReady: true,
      period,
      sport,
      metrics: {
        total: picks.length,
        settled: settled.length,
        pending: picks.length - settled.length,
        wins,
        losses,
        pushes,
        winRate: winsAndLosses ? wins / winsAndLosses : 0,
        units,
        roi: roiBase ? units / roiBase : 0,
        avgOdds,
      },
      picks: picks.slice(0, 20),
    });
  } catch (error) {
    console.error("Performance query error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown performance error",
      },
      { status: 500 },
    );
  }
}
