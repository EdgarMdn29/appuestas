import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { openai } from "@/lib/openai/client";
import { evaluateBet } from "@/lib/betting/engine";
import {
  estimateMlbMoneylineProbability,
  estimateMlbThreeWayProbability,
  type MlbPhase,
} from "@/lib/betting/mlb-model";

export const dynamic = "force-dynamic";

type OddsRow = {
  event_id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmaker_key: string;
  bookmaker_title: string;
  market: string;
  outcome: string;
  selection: string;
  price: number;
};

type MatchSnapshot = {
  id: string;
  date: string;
  startDateTimeUtc: string;
  homeTeam: {
    id: number;
    name: string;
    logo: string;
    score?: number;
  };
  awayTeam: {
    id: number;
    name: string;
    logo: string;
    score?: number;
  };
  pitchers: {
    home: {
      id: number;
      name: string;
      stats: {
        era: number | null;
        whip: number | null;
        wins: number | null;
        losses: number | null;
      };
    } | null;
    away: {
      id: number;
      name: string;
      stats: {
        era: number | null;
        whip: number | null;
        wins: number | null;
        losses: number | null;
      };
    } | null;
  };
  status: string;
  time: string;
};

type Snapshot = {
  date: string;
  league: string;
  totalMatches: number;
  matches: MatchSnapshot[];
};

function median(values: number[]) {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function inferMlbPhase(snapshotDate: string): MlbPhase {
  // 2026 postseason begins September 29. Keep the phase explicit so the
  // model does not silently apply a playoff adjustment to regular-season data.
  return snapshotDate >= "2026-09-29" ? "PLAYOFFS" : "REGULAR_SEASON";
}

function round(value: number, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildMarketOdds(rows: OddsRow[]) {
  const grouped = new Map<string, OddsRow[]>();

  for (const row of rows) {
    const key = [
      row.event_id,
      row.market,
      row.selection,
    ].join("|");

    const existing = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }

  return [...grouped.values()].map((group) => {
    const prices = group.map((row) => Number(row.price));
    const marketOdds = median(prices);

    return {
      eventId: group[0].event_id,
      market: group[0].market,
      outcome: group[0].outcome,
      selection: group[0].selection,
      marketOdds,
      bookmakers: group.map((row) => ({
        bookmaker: row.bookmaker_key,
        title: row.bookmaker_title,
        price: Number(row.price),
      })),
    };
  });
}

function normalizeOddsForEvent(
  rows: OddsRow[],
  pitchers: MatchSnapshot["pitchers"] | null,
  phase: MlbPhase,
) {
  return buildMarketOdds(rows).map((market) => {
    if (!market.marketOdds || !pitchers) {
      return { ...market, evaluation: null };
    }

    let estimatedProbability: number | null = null;
    let confidence = 30;

    if (market.market === "FULL_GAME_ML") {
      const model = estimateMlbMoneylineProbability(pitchers, phase);
      confidence = model.confidence;
      if (market.outcome === "HOME") estimatedProbability = model.homeProbability;
      if (market.outcome === "AWAY") estimatedProbability = model.awayProbability;
    }

    if (market.market === "F3_3WAY" || market.market === "F5_3WAY") {
      const innings = market.market === "F3_3WAY" ? 3 : 5;
      const model = estimateMlbThreeWayProbability(pitchers, innings, phase);
      confidence = model.confidence;
      if (market.outcome === "HOME") estimatedProbability = model.homeProbability;
      if (market.outcome === "DRAW") estimatedProbability = model.drawProbability;
      if (market.outcome === "AWAY") estimatedProbability = model.awayProbability;
    }

    if (estimatedProbability == null) {
      return { ...market, evaluation: null };
    }

    const evaluation = evaluateBet({
      estimatedProbability,
      odds: market.marketOdds,
      confidence,
    });

    return { ...market, evaluation };
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const snapshotDate =
      searchParams.get("date") ??
      new Date().toISOString().slice(0, 10);

    const { data: latestMlbSnapshot, error: mlbError } =
      await supabaseAdmin
        .from("mlb_snapshots")
        .select("data, captured_at, snapshot_slot")
        .eq("snapshot_date", snapshotDate)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (mlbError) {
      throw mlbError;
    }

    if (!latestMlbSnapshot) {
      return NextResponse.json(
        {
          success: false,
          error: `No MLB snapshot found for ${snapshotDate}`,
        },
        { status: 404 },
      );
    }

    const { data: latestOddsCapture, error: oddsCaptureError } =
      await supabaseAdmin
        .from("mlb_odds_snapshots")
        .select("captured_at")
        .eq("snapshot_date", snapshotDate)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (oddsCaptureError) {
      throw oddsCaptureError;
    }

    if (!latestOddsCapture) {
      return NextResponse.json(
        {
          success: false,
          error: `No MLB odds snapshot found for ${snapshotDate}`,
        },
        { status: 404 },
      );
    }

    const { data: oddsRows, error: oddsError } = await supabaseAdmin
      .from("mlb_odds_snapshots")
      .select(
        "event_id, commence_time, home_team, away_team, bookmaker_key, bookmaker_title, market, outcome, selection, price",
      )
      .eq("snapshot_date", snapshotDate)
      .eq("captured_at", latestOddsCapture.captured_at)
      .order("event_id")
      .order("market")
      .order("selection");

    if (oddsError) {
      throw oddsError;
    }

    const snapshot = latestMlbSnapshot.data as Snapshot;
    const phase = inferMlbPhase(snapshotDate);
    const typedOddsRows = (oddsRows ?? []) as OddsRow[];

    const events = new Map<
      string,
      {
        eventId: string;
        homeTeam: string;
        awayTeam: string;
        commenceTime: string;
        odds: OddsRow[];
      }
    >();

    for (const row of typedOddsRows) {
      const existing = events.get(row.event_id);

      if (existing) {
        existing.odds.push(row);
      } else {
        events.set(row.event_id, {
          eventId: row.event_id,
          homeTeam: row.home_team,
          awayTeam: row.away_team,
          commenceTime: row.commence_time,
          odds: [row],
        });
      }
    }

    const normalizedEvents = [...events.values()].map((event) => {
      const match = snapshot.matches.find(
        (item) =>
          item.homeTeam.name === event.homeTeam &&
          item.awayTeam.name === event.awayTeam,
      );

      return {
        eventId: event.eventId,
        matchup: `${event.awayTeam} @ ${event.homeTeam}`,
        commenceTime: event.commenceTime,
        pitchers: match?.pitchers ?? null,
        status: match?.status ?? "UNKNOWN",
        markets: normalizeOddsForEvent(event.odds, match?.pitchers ?? null, phase),
      };
    });


    const aiInput = {
      date: snapshotDate,
      phase,
      source: "APPuestas MLB Betting Engine",
      instructions: [
        "Analyze only the supplied data.",
        "Do not invent pitcher statistics, lineups, injuries, weather, bullpen data, or probabilities.",
        "The TypeScript engine is authoritative for mathematical calculations.",
        "Identify missing information that prevents a valid +EV recommendation.",
        "If evidence is insufficient, return NO BET.",
        "Explain contradictions or uncertainty explicitly.",
      ],
      matches: normalizedEvents,
    };

    const response = await openai.responses.create({
      model: "openai/gpt-5.6-luna",
      instructions: `
You are the AI audit and interpretation layer of APPuestas MLB.

Your job is NOT to invent betting probabilities.

The application code performs the mathematical calculations.
You must:

1. Audit the supplied MLB data.
2. Identify meaningful statistical advantages only when supported by supplied data.
3. Identify missing or unreliable information.
4. Reject unsupported betting conclusions.
5. Explain whether the supplied evidence is sufficient for further betting analysis.
6. Prefer NO BET when required information is missing.
7. Never fabricate pitchers, injuries, lineups, weather, bullpen status, or advanced metrics.

Return concise structured JSON.
      `,
      input: JSON.stringify(aiInput),
      text: {
        format: {
          type: "json_schema",
          name: "mlb_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: {
                type: "string",
              },
              overallDecision: {
                type: "string",
                enum: ["BET", "NO BET", "INSUFFICIENT DATA"],
              },
              dataQuality: {
                type: "string",
                enum: ["HIGH", "MEDIUM", "LOW"],
              },
              missingInformation: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              observations: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    eventId: {
                      type: "string",
                    },
                    observation: {
                      type: "string",
                    },
                    supportedByData: {
                      type: "boolean",
                    },
                  },
                  required: [
                    "eventId",
                    "observation",
                    "supportedByData",
                  ],
                },
              },
            },
            required: [
              "summary",
              "overallDecision",
              "dataQuality",
              "missingInformation",
              "observations",
            ],
          },
        },
      },
    });

    let aiAnalysis: unknown;

    try {
      aiAnalysis = JSON.parse(response.output_text);
    } catch {
      aiAnalysis = {
        summary: response.output_text,
        overallDecision: "INSUFFICIENT DATA",
        dataQuality: "LOW",
        missingInformation: [
          "Structured AI response could not be parsed.",
        ],
        observations: [],
      };
    }

    const aiObservations =
      typeof aiAnalysis === "object" &&
      aiAnalysis !== null &&
      "observations" in aiAnalysis &&
      Array.isArray((aiAnalysis as { observations?: unknown }).observations)
        ? (aiAnalysis as {
            observations: Array<{
              eventId: string;
              observation: string;
              supportedByData: boolean;
            }>;
          }).observations
        : [];

    const eventsWithJustification = normalizedEvents.map((event) => {
      const supportedObservations = aiObservations
        .filter(
          (observation) =>
            observation.eventId === event.eventId &&
            observation.supportedByData,
        )
        .map((observation) => observation.observation.trim())
        .filter(Boolean);

      const recommendation = event.markets
        .filter((market) => market.evaluation?.decision === "BET")
        .filter((market) => Number.isFinite(market.marketOdds))
        .sort(
          (a, b) =>
            (b.evaluation?.ev ?? -Infinity) -
            (a.evaluation?.ev ?? -Infinity),
        )[0];

      const justification =
        supportedObservations.slice(0, 2).join(" ") ||
        (recommendation?.evaluation
          ? `${recommendation.selection} is the selected outcome because the V1 model estimates ${(recommendation.evaluation.estimatedProbability * 100).toFixed(1)}% probability versus ${(recommendation.evaluation.impliedProbability * 100).toFixed(1)}% implied by the reference odds, producing ${(recommendation.evaluation.edge * 100).toFixed(1)}% edge and ${(recommendation.evaluation.ev * 100).toFixed(1)}% EV.`
          : "No supported +EV recommendation was produced for this game.");

      return { ...event, justification };
    });

    return NextResponse.json({
      success: true,
      date: snapshotDate,
      mlbSnapshot: {
        capturedAt: latestMlbSnapshot.captured_at,
        slot: latestMlbSnapshot.snapshot_slot,
        totalMatches: snapshot.totalMatches,
      },
      oddsSnapshot: {
        capturedAt: latestOddsCapture.captured_at,
        totalRows: typedOddsRows.length,
        totalEvents: normalizedEvents.length,
      },
      engine: {
        status: "MLB_V1",
        note:
          "Independent MLB V1 probability model is applied before market EV evaluation. FULL_GAME_ML, F3_3WAY, and F5_3WAY are priced in V1.",
      },
      events: eventsWithJustification,
      ai: aiAnalysis,
    });
} catch (error) {
  console.error("MLB analysis error:", error);

  return NextResponse.json(
    {
      success: false,
      error: JSON.stringify(error),
    },
    { status: 500 },
  );
}
}