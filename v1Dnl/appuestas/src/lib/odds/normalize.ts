export type OddsOutcome = {
  name: string;
  price: number;
};

export type OddsMarket = {
  key: string;
  lastUpdate: string;
  outcomes: OddsOutcome[];
};

export type OddsBookmaker = {
  key: string;
  title: string;
  markets: OddsMarket[];
};

export type OddsApiEvent = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
};

export type NormalizedSelection = {
  outcome: "HOME" | "DRAW" | "AWAY";
  team: string | null;
  price: number;
  bookmakerKey: string;
  bookmakerTitle: string;
  lastUpdate: string;
};

export type NormalizedMarket = {
  market: "F3_3WAY" | "F5_3WAY";
  selections: NormalizedSelection[];
};

export type NormalizedOddsEvent = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  markets: NormalizedMarket[];
};

export type MarketOddsBookmaker = {
  bookmakerKey: string;
  bookmakerTitle: string;
  price: number;
  isHighest: boolean;
  isLowest: boolean;
};

export type MarketOddsSelection = {
  outcome: "HOME" | "DRAW" | "AWAY";
  team: string | null;

  marketOdds: number;

  minimumOdds: number;
  maximumOdds: number;

  bookmakers: MarketOddsBookmaker[];
};

export type MarketOddsMarket = {
  market: "F3_3WAY" | "F5_3WAY";
  selections: MarketOddsSelection[];
};

export type MarketOddsEvent = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  markets: MarketOddsMarket[];
};

const MARKET_MAP: Record<
  string,
  "F3_3WAY" | "F5_3WAY"
> = {
  h2h_3_way_1st_3_innings: "F3_3WAY",
  h2h_3_way_1st_5_innings: "F5_3WAY",
};

function normalizeOutcome(
  outcomeName: string,
  homeTeam: string,
  awayTeam: string
): "HOME" | "DRAW" | "AWAY" | null {
  if (outcomeName === homeTeam) {
    return "HOME";
  }

  if (outcomeName === awayTeam) {
    return "AWAY";
  }

  if (outcomeName.toLowerCase() === "draw") {
    return "DRAW";
  }

  return null;
}

export function normalizeOddsEvent(
  event: OddsApiEvent
): NormalizedOddsEvent {
  const marketsByKey = new Map<
    "F3_3WAY" | "F5_3WAY",
    NormalizedMarket
  >();

  for (const bookmaker of event.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      const normalizedMarketName = MARKET_MAP[market.key];

      if (!normalizedMarketName) {
        continue;
      }

      if (!marketsByKey.has(normalizedMarketName)) {
        marketsByKey.set(normalizedMarketName, {
          market: normalizedMarketName,
          selections: [],
        });
      }

      const normalizedMarket =
        marketsByKey.get(normalizedMarketName);

      if (!normalizedMarket) {
        continue;
      }

      for (const outcome of market.outcomes ?? []) {
        const normalizedOutcome = normalizeOutcome(
          outcome.name,
          event.home_team,
          event.away_team
        );

        if (!normalizedOutcome) {
          continue;
        }

        normalizedMarket.selections.push({
          outcome: normalizedOutcome,

          team:
            normalizedOutcome === "DRAW"
              ? null
              : normalizedOutcome === "HOME"
                ? event.home_team
                : event.away_team,

          price: outcome.price,

          bookmakerKey: bookmaker.key,
          bookmakerTitle: bookmaker.title,

          lastUpdate: market.lastUpdate,
        });
      }
    }
  }

  return {
    gameId: event.id,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    commenceTime: event.commence_time,
    markets: Array.from(marketsByKey.values()),
  };
}

/**
 * Calculates the median of a numeric array.
 *
 * Examples:
 * [1.85, 1.91, 2.10] -> 1.91
 * [1.85, 1.91, 2.10, 2.80] -> 2.005
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate median of an empty array");
  }

  const sorted = [...values].sort((a, b) => a - b);

  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Calculates the consolidated Market Odds for one normalized event.
 *
 * Market Odds = median of all available bookmaker prices
 * for the same market + selection.
 */
export function calculateMarketOdds(
  event: NormalizedOddsEvent
): MarketOddsEvent {
  return {
    gameId: event.gameId,
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    commenceTime: event.commenceTime,

    markets: event.markets.map((market) => {
      const selectionsByOutcome = new Map<
        "HOME" | "DRAW" | "AWAY",
        NormalizedSelection[]
      >();

      for (const selection of market.selections) {
        const existing =
          selectionsByOutcome.get(selection.outcome) ?? [];

        existing.push(selection);

        selectionsByOutcome.set(
          selection.outcome,
          existing
        );
      }

      const selections: MarketOddsSelection[] = [];

      for (const [
        outcome,
        bookmakerSelections,
      ] of selectionsByOutcome.entries()) {
        const prices = bookmakerSelections.map(
          (selection) => selection.price
        );

        const marketOdds = calculateMedian(prices);

        const minimumOdds = Math.min(...prices);
        const maximumOdds = Math.max(...prices);

        selections.push({
          outcome,

          team:
            outcome === "DRAW"
              ? null
              : outcome === "HOME"
                ? event.homeTeam
                : event.awayTeam,

          marketOdds,

          minimumOdds,
          maximumOdds,

          bookmakers: bookmakerSelections.map(
            (selection) => ({
              bookmakerKey: selection.bookmakerKey,
              bookmakerTitle:
                selection.bookmakerTitle,

              price: selection.price,

              isHighest:
                selection.price === maximumOdds,

              isLowest:
                selection.price === minimumOdds,
            })
          ),
        });
      }

      return {
        market: market.market,
        selections,
      };
    }),
  };
}