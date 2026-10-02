import type { NflOddsMarket, NflOddsOutcome } from "@/lib/nfl/odds";

export type NflOddsObservation = {
  capture_id: string;
  nfl_game_id: string;
  bookmaker_key: string;
  bookmaker_title: string;
  market: NflOddsMarket;
  outcome: NflOddsOutcome;
  point: number | null;
  price: number;
  captured_at: string;
  odds_event_id: string;
};

export type NflBookmakerObservation = {
  captureId: string;
  nflGameId: string;
  oddsEventId: string;
  bookmakerKey: string;
  bookmakerTitle: string;
  market: NflOddsMarket;
  outcome: NflOddsOutcome;
  point: number | null;
  price: number;
  capturedAt: string;
};

export type NflOutcomeConsensus = {
  outcome: NflOddsOutcome;
  /** Original observed point for this side, including the SPREAD sign. */
  point: number | null;
  bookmakerCount: number;
  minPrice: number;
  medianPrice: number;
  maxPrice: number;
  impliedProbability: number;
  bookmakers: NflBookmakerObservation[];
};

export type NflMarketConsensus = {
  captureId: string;
  nflGameId: string;
  market: NflOddsMarket;
  point: number | null;
  outcomes: NflOutcomeConsensus[];
  complete: boolean;
  missingOutcomes: NflOddsOutcome[];
  overround: number | null;
  vig: number | null;
};

const MARKET_ORDER: Record<NflOddsMarket, number> = { MONEYLINE: 0, SPREAD: 1, TOTAL: 2 };
const OUTCOME_ORDER: Record<NflOddsOutcome, number> = { HOME: 0, AWAY: 1, OVER: 0, UNDER: 1 };
const REQUIRED_OUTCOMES: Record<NflOddsMarket, readonly NflOddsOutcome[]> = {
  MONEYLINE: ["HOME", "AWAY"],
  SPREAD: ["HOME", "AWAY"],
  TOTAL: ["OVER", "UNDER"],
};
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export function decimalOddsToImpliedProbability(price: number): number {
  if (!Number.isFinite(price) || price <= 1) {
    throw new RangeError("Decimal odds must be a finite number greater than 1");
  }
  return 1 / price;
}

export function calculateTwoOutcomeOverround(
  market: NflOddsMarket,
  point: number | null,
  outcomes: readonly NflOutcomeConsensus[],
): { overround: number; vig: number } | null {
  if ((market === "MONEYLINE") !== (point === null)) return null;
  if (outcomes.some((outcome) => outcome.bookmakers.some((bookmaker) =>
    bookmaker.market !== market || conceptualPointKey(market, bookmaker.point) !== pointKey(point)))) return null;
  const required = REQUIRED_OUTCOMES[market];
  const sides = required.map((side) => outcomes.find((outcome) => outcome.outcome === side));
  if (!sides[0] || !sides[1]) return null;
  const overround = sides[0].impliedProbability + sides[1].impliedProbability;
  return { overround, vig: overround - 1 };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pointKey(point: number | null): string {
  if (point === null) return "null";
  if (!Number.isFinite(point)) throw new RangeError("Market point must be finite or null");
  return Object.is(point, -0) ? "0" : String(point);
}

function conceptualPoint(market: NflOddsMarket, point: number | null): number | null {
  return market === "SPREAD" && point !== null ? Math.abs(point) : point;
}

function conceptualPointKey(market: NflOddsMarket, point: number | null): string {
  return pointKey(conceptualPoint(market, point));
}

/**
 * Computes independent market/line groups. Capture ID is part of the internal
 * key so callers can safely pass rows from more than one historical capture.
 */
export function calculateNflMarketConsensus(
  observations: readonly NflOddsObservation[],
): NflMarketConsensus[] {
  const groups = new Map<string, NflOddsObservation[]>();
  for (const observation of observations) {
    const expectedPointIsNull = observation.market === "MONEYLINE";
    if (expectedPointIsNull !== (observation.point === null)) {
      throw new Error(`Invalid point for ${observation.market} observation`);
    }
    decimalOddsToImpliedProbability(observation.price);
    const key = JSON.stringify([observation.capture_id, observation.nfl_game_id, observation.market, conceptualPointKey(observation.market, observation.point)]);
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }

  const results: NflMarketConsensus[] = [];
  for (const rows of groups.values()) {
    const first = rows[0];
    const byOutcome = new Map<NflOddsOutcome, NflOddsObservation[]>();
    for (const row of rows) {
      const sameGroup = row.capture_id === first.capture_id
        && row.nfl_game_id === first.nfl_game_id
        && row.market === first.market
        && conceptualPointKey(row.market, row.point) === conceptualPointKey(first.market, first.point);
      if (!sameGroup) throw new Error("Consensus group contains mixed capture, game, market, or point values");
      const group = byOutcome.get(row.outcome) ?? [];
      group.push(row);
      byOutcome.set(row.outcome, group);
    }

    const outcomes = [...byOutcome.entries()]
      .map(([outcome, outcomeRows]): NflOutcomeConsensus => {
        const bookmakers = outcomeRows
          .map((row): NflBookmakerObservation => ({
            captureId: row.capture_id,
            nflGameId: row.nfl_game_id,
            oddsEventId: row.odds_event_id,
            bookmakerKey: row.bookmaker_key,
            bookmakerTitle: row.bookmaker_title,
            market: row.market,
            outcome: row.outcome,
            point: row.point,
            price: row.price,
            capturedAt: row.captured_at,
          }))
          .sort((left, right) => compareText(left.bookmakerKey, right.bookmakerKey));
        const prices = outcomeRows.map((row) => row.price);
        const medianPrice = median(prices);
        return {
          outcome,
          point: outcomeRows[0].point,
          bookmakerCount: new Set(outcomeRows.map((row) => row.bookmaker_key)).size,
          minPrice: Math.min(...prices),
          medianPrice,
          maxPrice: Math.max(...prices),
          impliedProbability: decimalOddsToImpliedProbability(medianPrice),
          bookmakers,
        };
      })
      .sort((left, right) => OUTCOME_ORDER[left.outcome] - OUTCOME_ORDER[right.outcome]);
    const required = REQUIRED_OUTCOMES[first.market];
    const missingOutcomes = required.filter((outcome) => !byOutcome.has(outcome));
    const groupPoint = conceptualPoint(first.market, first.point);
    const marketVig = calculateTwoOutcomeOverround(first.market, groupPoint, outcomes);
    results.push({
      captureId: first.capture_id,
      nflGameId: first.nfl_game_id,
      market: first.market,
      point: groupPoint,
      outcomes,
      complete: missingOutcomes.length === 0,
      missingOutcomes,
      overround: marketVig?.overround ?? null,
      vig: marketVig?.vig ?? null,
    });
  }

  return results.sort((left, right) =>
    compareText(left.captureId, right.captureId)
      || compareText(left.nflGameId, right.nflGameId)
      || MARKET_ORDER[left.market] - MARKET_ORDER[right.market]
      || ((left.point ?? Number.NEGATIVE_INFINITY) - (right.point ?? Number.NEGATIVE_INFINITY)),
  );
}
