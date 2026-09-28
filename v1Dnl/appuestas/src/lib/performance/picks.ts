import { supabaseAdmin } from "@/lib/supabase/admin";

export type PickSport = "MLB" | "NFL";
export type PickResult = "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
export type PickPhase = "REGULAR_SEASON" | "PLAYOFFS";

export type HistoricalPick = {
  id?: string;
  sport: PickSport;
  event_id: string;
  event_date: string;
  created_at?: string;
  home_team?: string | null;
  away_team?: string | null;
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
  result?: PickResult;
  settled_at?: string | null;
  is_parlay?: boolean;
  parlay_id?: string | null;
  phase?: PickPhase | null;
  model_version: string;
  prompt_version: string;
  config_version: string;
};

export async function saveHistoricalPick(
  pick: HistoricalPick,
) {
  const { data, error } = await supabaseAdmin
    .from("betting_picks")
    .insert({
      ...pick,
      result: pick.result ?? "PENDING",
      is_parlay: pick.is_parlay ?? false,
      settled_at: pick.settled_at ?? null,
      parlay_id: pick.parlay_id ?? null,
      phase: pick.phase ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}
