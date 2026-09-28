import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { openai } from "@/lib/openai/client";
import { evaluateBet } from "@/lib/betting/engine";
import { saveHistoricalPick } from "@/lib/performance/picks";

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

function normalizeOddsForEvent(rows: OddsRow[]) {
  return buildMarketOdds(rows).map((market) => {
    if (!market.marketOdds) {
      return {
        ...market,
        evaluation: null,
      };
    }

    /*
     * Until we have the full sabermetric probability model,
     * we do NOT invent a probability.
     *
     * The engine therefore receives a neutral probability derived
     * only from the market price. This is explicitly marked as
     * provisional and must not be treated as a betting edge.
     */
    const impliedProbability = 1 / market.marketOdds;

    const evaluation = evaluateBet({
      estimatedProbability: impliedProbability,
      odds: market.marketOdds,
      confidence: 0,
      uncertaintyPenalty: 100,
    });

    return {
      ...market,
      evaluation,
    };
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
          item.homeTeam.name === event.homeTeam ||
          item.awayTeam.name === event.awayTeam,
      );

      return {
        eventId: event.eventId,
        matchup: `${event.awayTeam} @ ${event.homeTeam}`,
        commenceTime: event.commenceTime,
        pitchers: match?.pitchers ?? null,
        status: match?.status ?? "UNKNOWN",
        markets: normalizeOddsForEvent(event.odds),
      };
    });

    /*
     * Persist only actual BET decisions.
     *
     * The betting engine remains authoritative for all
     * mathematical calculations.
     */
    for (const event of normalizedEvents) {
      for (const market of event.markets) {
        if (
          !market.evaluation ||
          market.evaluation.decision !== "BET" ||
          market.marketOdds == null
        ) {
          continue;
        }

        const [awayTeam, homeTeam] = event.matchup.split(" @ ");

        await saveHistoricalPick({
          sport: "MLB",
          event_id: event.eventId,
          event_date: snapshotDate,
          home_team: homeTeam ?? null,
          away_team: awayTeam ?? null,
          market: market.market,
          selection: market.selection,
          odds: Number(market.marketOdds),
          estimated_probability: 1 / Number(market.marketOdds),
          implied_probability: market.evaluation.impliedProbability,
          edge: market.evaluation.edge,
          ev: market.evaluation.ev,
          confidence: market.evaluation.confidence,
          grade: market.evaluation.grade,
          decision: market.evaluation.decision,
          units: market.evaluation.units,
          result: "PENDING",
          is_parlay: false,
          phase: "REGULAR_SEASON",
          model_version: "provisional",
          prompt_version: "current",
          config_version: "current",
        });
      }
    }

    const aiInput = {
      date: snapshotDate,
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
        missingInformation: ["Structured AI response could not be parsed."],
        observations: [],
      };
    }

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
        status: "PROVISIONAL",
        note:
          "Advanced probability model is not yet populated. No betting edge is inferred from market odds alone.",
      },
      events: normalizedEvents,
      ai: aiAnalysis,
    });
  } catch (error) {
    console.error("MLB analysis error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown MLB analysis error",
      },
      { status: 500 },
    );
  }
}
