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
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("betting_picks")
    .select("id")
    .eq("sport", pick.sport)
    .eq("event_id", pick.event_id)
    .eq("event_date", pick.event_date)
    .eq("market", pick.market)
    .eq("selection", pick.selection)
    .eq("model_version", pick.model_version)
    .eq("prompt_version", pick.prompt_version)
    .eq("config_version", pick.config_version)
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

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
