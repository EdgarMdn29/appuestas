"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
} from "react";

type League = "mlb" | "nfl";
type View = "dashboard" | "sport";
type PerformancePeriod = "7d" | "30d" | "all";
type PerformanceSport = "MLB" | "NFL" | "COMBINED";

type Team = {
  id: number;
  name: string;
  logo: string | null;
  score: number | null;
};

type Pitcher = {
  id: number;
  name: string;
  stats: {
    era: string | number | null;
    whip: string | number | null;
    wins: string | number | null;
    losses: string | number | null;
  } | null;
};

type Fixture = {
  id: string;
  date: string;
  startDateTimeUtc: string;
  homeTeam: Team;
  awayTeam: Team;
  pitchers: {
    home: Pitcher | null;
    away: Pitcher | null;
  };
  status: string;
  time: string;
};

type FixturesResponse = {
  success: boolean;
  snapshotDate: string;
  snapshotSlot?: string;
  totalMatches: number;
  matches: Fixture[];
};

type Bookmaker = {
  bookmakerKey: string;
  bookmakerTitle: string;
  price: number;
  isHighest: boolean;
  isLowest: boolean;
};

type Selection = {
  outcome: "HOME" | "DRAW" | "AWAY";
  selection: string;
  marketOdds: number;
  minimumOdds: number;
  maximumOdds: number;
  bookmakers: Bookmaker[];
};

type OddsMarket = {
  market:
    | "F3_3WAY"
    | "F5_3WAY"
    | "FULL_GAME_ML"
    | string;
  selections: Selection[];
};

type OddsEvent = {
  eventId: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  markets: OddsMarket[];
};

type OddsResponse = {
  success: boolean;
  snapshotDate: string;
  totalRows: number;
  totalEvents: number;
  events: OddsEvent[];
};

type AnalysisEvaluation = {
  estimatedProbability: number;
  impliedProbability: number;
  edge: number;
  ev: number;
  confidence: number;
  grade: string;
  decision: "BET" | "NO BET";
  units: number;
};

type AnalysisMarket = {
  eventId: string;
  market: string;
  outcome: "HOME" | "DRAW" | "AWAY";
  selection: string;
  marketOdds: number | null;
  evaluation: AnalysisEvaluation | null;
};

type AnalysisEvent = {
  eventId: string;
  matchup: string;
  commenceTime: string;
  justification?: string;
  markets: AnalysisMarket[];
};

type MlbAnalysisResponse = {
  success: boolean;
  events?: AnalysisEvent[];
  error?: string;
};

type AcceptedBet = {
  eventId: string;
  market: string;
  selection: string;
};

type BetPickPayload = {
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

type ExpandedMarket = {
  gameId: string;
  market: string;
} | null;

type PerformancePick = {
  id: string;
  sport: "MLB" | "NFL";
  event_date: string;
  created_at: string;
  selection: string;
  market: string;
  odds: number;
  result: "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
  units: number;
  is_parlay: boolean;
};

type PerformanceResponse = {
  success: boolean;
  tableReady?: boolean;
  metrics?: {
    total: number;
    settled: number;
    pending: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number;
    units: number;
    roi: number;
    avgOdds: number;
  } | null;
  picks: PerformancePick[];
  error?: string;
};

const LOGIN_USERNAME = "admin";
const LOGIN_PASSWORD = "P4$$w0rd26!";

const MARKET_LABELS: Record<string, string> = {
  F3_3WAY: "F3",
  F5_3WAY: "F5",
  FULL_GAME_ML: "ML",
};

function truncateToTwoDecimals(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2);
}

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTeamName(name: string): { city: string; team: string } {
  const parts = name.trim().split(/\s+/);

  if (parts.length <= 1) {
    return { city: name, team: "" };
  }

  const nicknames = new Set([
    "Red Sox", "White Sox", "Blue Jays", "Diamondbacks",
    "Guardians", "Orioles", "Phillies", "Braves", "Yankees",
    "Mets", "Nationals", "Marlins", "Rays", "Royals", "Twins",
    "Tigers", "Astros", "Rangers", "Angels", "Athletics",
    "Mariners", "Rockies", "Cubs", "Brewers", "Pirates",
    "Cardinals", "Reds", "Dodgers", "Padres", "Giants",
  ]);

  const twoWordNickname = parts.slice(-2).join(" ");
  if (nicknames.has(twoWordNickname)) {
    return { city: parts.slice(0, -2).join(" "), team: twoWordNickname };
  }

  return { city: parts.slice(0, -1).join(" "), team: parts.at(-1) ?? "" };
}

function formatPitcher(pitcher: Pitcher | null): string {
  if (!pitcher) {
    return "TBD";
  }

  if (!pitcher.stats) {
    return pitcher.name;
  }

  const { era, whip, wins, losses } = pitcher.stats;

  if (
    era === null &&
    whip === null &&
    wins === null &&
    losses === null
  ) {
    return pitcher.name;
  }

  const record =
    wins !== null && losses !== null
      ? `${wins}-${losses}`
      : "";

  const eraText =
    era !== null ? `ERA ${era}` : "";

  const whipText =
    whip !== null ? `WHIP ${whip}` : "";

  const details = [record, eraText, whipText]
    .filter(Boolean)
    .join(" · ");

  return details
    ? `${pitcher.name} (${details})`
    : pitcher.name;
}

function isFinalStatus(status: string): boolean {
  const value = status.toLowerCase();

  return (
    value.includes("final") ||
    value.includes("game over") ||
    value.includes("completed")
  );
}

function isLiveStatus(status: string): boolean {
  const value = status.toLowerCase();

  return (
    value.includes("progress") ||
    value.includes("live") ||
    value.includes("in progress") ||
    value.includes("manager review") ||
    value.includes("warmup")
  );
}

function isScheduledStatus(status: string): boolean {
  const value = status.toLowerCase();

  return (
    value.includes("scheduled") ||
    value.includes("pre-game") ||
    value.includes("pregame")
  );
}

function getStatusClass(status: string): string {
  if (isFinalStatus(status)) {
    return "text-gray-400";
  }

  if (isLiveStatus(status)) {
    return "text-green-400";
  }

  if (isScheduledStatus(status)) {
    return "text-gray-500";
  }

  return "text-gray-400";
}

function getStatusLabel(status: string): string {
  if (isFinalStatus(status)) {
    return "FINAL";
  }

  if (isLiveStatus(status)) {
    return "LIVE";
  }

  if (isScheduledStatus(status)) {
    return "SCHEDULED";
  }

  return status.toUpperCase();
}

function getMexicoCityDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getCurrentMexicoCityHour(): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    hour12: false,
  }).format(new Date());

  return Number(hour);
}

function getFixtureSlots(date: string): string[] {
  const today = getMexicoCityDate();

  if (date < today) {
    return ["17", "14", "09"];
  }

  if (date > today) {
    return ["09", "14", "17"];
  }

  const hour = getCurrentMexicoCityHour();

  if (hour < 14) {
    return ["09", "14", "17"];
  }

  if (hour < 17) {
    return ["14", "17", "09"];
  }

  return ["17", "14", "09"];
}

function findOddsEvent(
  fixture: Fixture,
  oddsEvents: OddsEvent[]
): OddsEvent | null {
  const fixtureHome = normalizeTeamName(fixture.homeTeam.name);
  const fixtureAway = normalizeTeamName(fixture.awayTeam.name);

  return (
    oddsEvents.find((event) => {
      const oddsHome = normalizeTeamName(event.homeTeam);
      const oddsAway = normalizeTeamName(event.awayTeam);

      return (
        oddsHome === fixtureHome &&
        oddsAway === fixtureAway
      );
    }) ?? null
  );
}

function getMarket(
  event: OddsEvent | null,
  marketKey: string
): OddsMarket | null {
  if (!event) {
    return null;
  }

  return (
    event.markets.find(
      (market) => market.market === marketKey
    ) ?? null
  );
}

function getOutcomeSelection(
  market: OddsMarket | null,
  outcome: "HOME" | "DRAW" | "AWAY"
): Selection | null {
  if (!market) {
    return null;
  }

  return (
    market.selections.find(
      (selection) => selection.outcome === outcome
    ) ?? null
  );
}

function getCompactOdds(
  selection: Selection | null
): string {
  if (!selection) {
    return "—";
  }

  return truncateToTwoDecimals(selection.marketOdds);
}

function getBookmakerClass(bookmaker: Bookmaker): string {
  if (bookmaker.isHighest && bookmaker.isLowest) {
    return "text-gray-200";
  }

  if (bookmaker.isHighest) {
    return "text-green-400";
  }

  if (bookmaker.isLowest) {
    return "text-red-400";
  }

  return "text-gray-400";
}

function formatGameScore(
  fixture: Fixture
): string | null {
  const scoreAway = fixture.awayTeam.score;
  const scoreHome = fixture.homeTeam.score;

  if (
    scoreAway === null &&
    scoreHome === null
  ) {
    return null;
  }

  if (
    !isFinalStatus(fixture.status) &&
    !isLiveStatus(fixture.status)
  ) {
    return null;
  }

  return `${scoreAway ?? 0} - ${scoreHome ?? 0}`;
}

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] =
    useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] =
    useState("");

  const [view, setView] = useState<View>("dashboard");

  const [selectedLeague, setSelectedLeague] =
    useState<League>("mlb");

  const [performancePeriod, setPerformancePeriod] =
    useState<PerformancePeriod>("7d");

  const [performanceSport, setPerformanceSport] =
    useState<PerformanceSport>("MLB");

  const [performance, setPerformance] =
    useState<PerformanceResponse | null>(null);

  const [performanceLoading, setPerformanceLoading] =
    useState(false);

  const [selectedDate, setSelectedDate] =
    useState(() => {
      const now = new Date();

      const mexicoDate = new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: "America/Mexico_City",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }
      ).format(now);

      return mexicoDate;
    });

  const [fixtures, setFixtures] =
    useState<Fixture[]>([]);

  const [oddsEvents, setOddsEvents] =
    useState<OddsEvent[]>([]);

  const [analysisEvents, setAnalysisEvents] =
    useState<AnalysisEvent[]>([]);

  const [analysisLoading, setAnalysisLoading] =
    useState(false);

  const [analysisError, setAnalysisError] =
    useState("");

  const [bettingEventId, setBettingEventId] =
    useState<string | null>(null);

  const [acceptedBets, setAcceptedBets] =
    useState<AcceptedBet[]>([]);

  const [betError, setBetError] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [expandedMarket, setExpandedMarket] =
    useState<ExpandedMarket>(null);

  const [lastUpdated, setLastUpdated] =
    useState<string | null>(null);

  useEffect(() => {
    const savedLogin =
      window.localStorage.getItem(
        "appuestas_authenticated"
      );

    if (savedLogin === "true") {
      setIsLoggedIn(true);
    }
  }, []);

  async function loadPerformance() {
    setPerformanceLoading(true);

    try {
      const response = await fetch(
        `/api/performance?period=${performancePeriod}&sport=${performanceSport}`,
        { cache: "no-store" },
      );

      const data = (await response.json()) as PerformanceResponse;
      setPerformance(data);
    } catch (err) {
      console.error(err);
      setPerformance({
        success: false,
        picks: [],
        error: "Unable to load performance data.",
      });
    } finally {
      setPerformanceLoading(false);
    }
  }

  async function loadMLB() {
    setLoading(true);
    setError("");
    setAnalysisError("");
    setBetError("");
    setExpandedMarket(null);

    try {
      const slots = getFixtureSlots(selectedDate);

      let fixturesResponse: Response | null =
        null;

      let fixturesData: FixturesResponse | null =
        null;

      for (const slot of slots) {
        const response = await fetch(
          `/api/fixtures/mlb?date=${selectedDate}&slot=${slot}`,
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          continue;
        }

        const data =
          (await response.json()) as FixturesResponse;

        if (data.matches) {
          fixturesResponse = response;
          fixturesData = data;
          break;
        }
      }

      if (!fixturesResponse || !fixturesData) {
        throw new Error(
          "MLB fixtures request failed."
        );
      }

      const oddsResponse = await fetch(
        `/api/odds-test/mlb?date=${selectedDate}`,
        {
          cache: "no-store",
        }
      );

      setFixtures(fixturesData.matches ?? []);

      if (oddsResponse.ok) {
        const oddsData =
          (await oddsResponse.json()) as OddsResponse;

        if (oddsData.success) {
          setOddsEvents(oddsData.events ?? []);
        } else {
          setOddsEvents([]);
        }
      } else {
        setOddsEvents([]);
      }

      setLastUpdated(
        new Intl.DateTimeFormat("es-MX", {
          timeZone: "America/Mexico_City",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date())
      );
    } catch (err) {
      console.error(err);

      setFixtures([]);
      setOddsEvents([]);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load MLB data."
      );
    } finally {
      setLoading(false);
    }
  }

  async function runAnalysis() {
    setAnalysisLoading(true);
    setAnalysisError("");
    setBetError("");

    try {
      const response = await fetch(
        `/api/analyze/mlb?date=${selectedDate}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as MlbAnalysisResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "MLB analysis failed.");
      }

      const normalizedAnalysis = (data.events ?? []).map((event) => ({
        ...event,
        markets: event.markets.map((market) => ({
          ...market,
          eventId: event.eventId,
        })),
      }));

      setAnalysisEvents(normalizedAnalysis);
      setAcceptedBets([]);
      window.localStorage.setItem(
        `appuestas_mlb_analysis_${selectedDate}`,
        JSON.stringify(normalizedAnalysis),
      );
      window.localStorage.removeItem(
        `appuestas_mlb_accepted_bets_${selectedDate}`,
      );
    } catch (err) {
      console.error(err);
      setAnalysisEvents([]);
      setAnalysisError(err instanceof Error ? err.message : "Unable to run MLB analysis.");
    } finally {
      setAnalysisLoading(false);
    }
  }

  function getRecommendation(game: Fixture) {
    const oddsEvent = findOddsEvent(game, oddsEvents);
    if (!oddsEvent) return null;

    const event = analysisEvents.find((item) => item.eventId === oddsEvent.eventId);
    if (!event) return null;

    return event.markets
      .filter((market) => market.evaluation?.decision === "BET")
      .filter((market) => Number.isFinite(market.marketOdds))
      .sort((a, b) => (b.evaluation?.ev ?? -Infinity) - (a.evaluation?.ev ?? -Infinity))[0] ?? null;
  }

  async function acceptBet(game: Fixture, recommendation: AnalysisMarket) {
    const evaluation = recommendation.evaluation;
    const odds = recommendation.marketOdds;
    if (!evaluation || odds == null || evaluation.decision !== "BET") return;

    const acceptedKey = {
      eventId: recommendation.eventId,
      market: recommendation.market,
      selection: recommendation.selection,
    };

    if (acceptedBets.some(
      (bet) =>
        bet.eventId === acceptedKey.eventId &&
        bet.market === acceptedKey.market &&
        bet.selection === acceptedKey.selection,
    )) {
      return;
    }

    setBettingEventId(game.id);
    setBetError("");

    const payload: BetPickPayload = {
      sport: "MLB",
      event_id: recommendation.eventId,
      event_date: selectedDate,
      home_team: game.homeTeam.name,
      away_team: game.awayTeam.name,
      market: recommendation.market,
      selection: recommendation.selection,
      odds,
      estimated_probability: evaluation.estimatedProbability,
      implied_probability: evaluation.impliedProbability,
      edge: evaluation.edge,
      ev: evaluation.ev,
      confidence: evaluation.confidence,
      grade: evaluation.grade,
      decision: "BET",
      units: evaluation.units,
      phase: selectedDate >= "2026-09-29" ? "PLAYOFFS" : "REGULAR_SEASON",
      model_version: "MLB_V1",
      prompt_version: "MLB_ANALYSIS_V1",
      config_version: "MLB_V1",
    };

    try {
      const response = await fetch("/api/picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (response.status === 409 && data.error === "This pick is already saved.") {
        const nextAcceptedBets = acceptedBets.some(
          (bet) =>
            bet.eventId === acceptedKey.eventId &&
            bet.market === acceptedKey.market &&
            bet.selection === acceptedKey.selection,
        )
          ? acceptedBets
          : [...acceptedBets, acceptedKey];

        setAcceptedBets(nextAcceptedBets);
        window.localStorage.setItem(
          `appuestas_mlb_accepted_bets_${selectedDate}`,
          JSON.stringify(nextAcceptedBets),
        );
        setBetError("");
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Unable to save bet.");
      }

      const nextAcceptedBets = [...acceptedBets, acceptedKey];
      setAcceptedBets(nextAcceptedBets);
      window.localStorage.setItem(
        `appuestas_mlb_accepted_bets_${selectedDate}`,
        JSON.stringify(nextAcceptedBets),
      );
    } catch (err) {
      console.error(err);
      setBetError(err instanceof Error ? err.message : "Unable to save bet.");
    } finally {
      setBettingEventId(null);
    }
  }

  useEffect(() => {
    if (!isLoggedIn || view !== "sport" || selectedLeague !== "mlb") {
      return;
    }

    const stored = window.localStorage.getItem(
      `appuestas_mlb_analysis_${selectedDate}`,
    );

    if (!stored) {
      setAnalysisEvents([]);
      setAcceptedBets([]);
      return;
    }

    try {
      setAnalysisEvents(JSON.parse(stored) as AnalysisEvent[]);
      const accepted = window.localStorage.getItem(
        `appuestas_mlb_accepted_bets_${selectedDate}`,
      );
      setAcceptedBets(accepted ? (JSON.parse(accepted) as AcceptedBet[]) : []);
      setAnalysisError("");
    } catch {
      window.localStorage.removeItem(
        `appuestas_mlb_analysis_${selectedDate}`,
      );
      setAnalysisEvents([]);
      setAcceptedBets([]);
    }
  }, [isLoggedIn, view, selectedLeague, selectedDate]);

  useEffect(() => {
    if (!isLoggedIn || view !== "dashboard") {
      return;
    }

    loadPerformance();
  }, [isLoggedIn, view, performancePeriod, performanceSport]);

  useEffect(() => {
    if (!isLoggedIn || view !== "sport") {
      return;
    }

    if (selectedLeague !== "mlb") {
      return;
    }

    loadMLB();
  }, [isLoggedIn, view, selectedLeague, selectedDate]);

  function handleLogin(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setLoginError("");

    if (
      username === LOGIN_USERNAME &&
      password === LOGIN_PASSWORD
    ) {
      window.localStorage.setItem(
        "appuestas_authenticated",
        "true"
      );

      setIsLoggedIn(true);
      setUsername("");
      setPassword("");
      return;
    }

    setLoginError("Invalid credentials.");
  }

  function handleLogout() {
    window.localStorage.removeItem(
      "appuestas_authenticated"
    );

    setIsLoggedIn(false);
    setView("dashboard");
    setPerformance(null);
    setFixtures([]);
    setOddsEvents([]);
  }

  function toggleMarket(
    gameId: string,
    market: string
  ) {
    setExpandedMarket((current) => {
      if (
        current?.gameId === gameId &&
        current.market === market
      ) {
        return null;
      }

      return {
        gameId,
        market,
      };
    });
  }

  const fixtureCount = useMemo(
    () => fixtures.length,
    [fixtures]
  );

  if (!isLoggedIn) {
    return (
      <main className="min-h-screen bg-black text-green-500 flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <form
            onSubmit={handleLogin}
            className="space-y-5"
          >
            <div>
              <label
                htmlFor="username"
                className="mb-2 block font-mono text-xs text-gray-500"
              >
                USER
              </label>

              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                className="w-full border border-gray-800 bg-black px-3 py-2 font-mono text-sm text-gray-300 outline-none focus:border-gray-600"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block font-mono text-xs text-gray-500"
              >
                PASS
              </label>

              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                className="w-full border border-gray-800 bg-black px-3 py-2 font-mono text-sm text-gray-300 outline-none focus:border-gray-600"
              />
            </div>

            {loginError && (
              <div className="font-mono text-xs text-red-500">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              className="w-full border border-gray-800 bg-black px-3 py-2 font-mono text-xs text-gray-400 transition hover:border-gray-600 hover:text-gray-200"
            >
              LOGIN
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-gray-200">
      <header className="border-b border-gray-900 bg-black">
        <div className="mx-auto flex h-20 max-w-[1600px] items-center justify-between px-6">
          <div className="flex items-center">
            <img
              src="/appuestas-logo.png"
              alt="APPuestas"
              className="h-12 w-auto object-contain"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView("dashboard")}
              className={`border px-4 py-2 font-mono text-xs transition ${
                view === "dashboard"
                  ? "border-gray-500 bg-gray-900 text-white"
                  : "border-gray-800 bg-black text-gray-500 hover:border-gray-700 hover:text-gray-300"
              }`}
            >
              DASHBOARD
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedLeague("mlb");
                setView("sport");
              }}
              className={`border px-4 py-2 font-mono text-xs transition ${
                view === "sport" && selectedLeague === "mlb"
                  ? "border-gray-500 bg-gray-900 text-white"
                  : "border-gray-800 bg-black text-gray-500 hover:border-gray-700 hover:text-gray-300"
              }`}
            >
              MLB
            </button>

            <button
              type="button"
              disabled
              className="cursor-not-allowed border border-gray-900 bg-black px-4 py-2 font-mono text-xs text-gray-700"
            >
              NFL
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="ml-3 border border-gray-900 bg-black px-3 py-2 font-mono text-xs text-gray-600 hover:border-gray-700 hover:text-gray-400"
            >
              LOGOUT
            </button>
          </div>
        </div>
      </header>

      {view === "dashboard" ? (
        <section className="mx-auto max-w-[1600px] px-6 py-6">
          <div className="mb-6">
            <h1 className="font-mono text-lg text-gray-200">
              PERFORMANCE
            </h1>
            <div className="mt-1 font-mono text-xs text-gray-600">
              Historical recommendations only. Results are not recalculated when the model changes.
            </div>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            {([
              ["7d", "7 DÍAS"],
              ["30d", "30 DÍAS"],
              ["all", "GENERAL"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPerformancePeriod(value)}
                className={`border px-4 py-2 font-mono text-[11px] ${
                  performancePeriod === value
                    ? "border-gray-500 bg-gray-900 text-white"
                    : "border-gray-800 text-gray-600 hover:border-gray-700 hover:text-gray-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            {([
              ["MLB", "MLB"],
              ["NFL", "NFL"],
              ["COMBINED", "COMBINADA"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={value === "NFL"}
                onClick={() => setPerformanceSport(value)}
                className={`border px-4 py-2 font-mono text-[11px] ${
                  value === "NFL"
                    ? "cursor-not-allowed border-gray-900 text-gray-800"
                    : performanceSport === value
                      ? "border-gray-500 bg-gray-900 text-white"
                      : "border-gray-800 text-gray-600 hover:border-gray-700 hover:text-gray-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {performance?.tableReady === false ? (
            <div className="mb-6 border border-yellow-950 bg-[#0a0904] px-4 py-4 font-mono text-xs text-yellow-700">
              PERFORMANCE DATA NOT INITIALIZED — run the Supabase migration in <span className="text-yellow-500">supabase/migrations/001_create_betting_picks.sql</span>.
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-6">
            {[
              ["WINS", performance?.metrics?.wins ?? 0],
              ["LOSSES", performance?.metrics?.losses ?? 0],
              ["WIN RATE", `${((performance?.metrics?.winRate ?? 0) * 100).toFixed(1)}%`],
              ["UNITS", (performance?.metrics?.units ?? 0).toFixed(2)],
              ["ROI", `${((performance?.metrics?.roi ?? 0) * 100).toFixed(1)}%`],
              ["RECORD", `${performance?.metrics?.wins ?? 0}-${performance?.metrics?.losses ?? 0}-${performance?.metrics?.pushes ?? 0}`],
            ].map(([label, value]) => (
              <div key={String(label)} className="border border-gray-900 bg-[#050505] px-4 py-4">
                <div className="font-mono text-[10px] text-gray-600">{label}</div>
                <div className="mt-2 font-mono text-xl text-gray-300">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 border border-gray-900 bg-[#050505]">
            <div className="border-b border-gray-900 px-4 py-3 font-mono text-[10px] tracking-wider text-gray-600">
              RECENT PICKS
            </div>

            {performanceLoading ? (
              <div className="px-4 py-8 text-center font-mono text-xs text-gray-700">Loading performance...</div>
            ) : performance?.picks?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse">
                  <thead>
                    <tr className="border-b border-gray-900">
                      {['DATE', 'SPORT', 'PICK', 'MARKET', 'ODDS', 'RESULT', 'UNITS'].map((label) => (
                        <th key={label} className="px-4 py-3 text-left font-mono text-[10px] font-normal text-gray-600">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {performance.picks.map((pick) => (
                      <tr key={pick.id} className="border-b border-gray-900 last:border-0">
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{pick.event_date}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{pick.sport}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-300">{pick.selection}{pick.is_parlay ? ' · PARLAY' : ''}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{pick.market}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{Number(pick.odds).toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{pick.result}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{Number(pick.units).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-10 text-center font-mono text-xs text-gray-700">No historical recommendations yet.</div>
            )}
          </div>

          {performance?.error ? (
            <div className="mt-4 border border-red-950 bg-[#0b0505] px-4 py-3 font-mono text-xs text-red-400">{performance.error}</div>
          ) : null}
        </section>
      ) : (
        <section className="mx-auto max-w-[1600px] px-6 py-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-mono text-lg text-gray-200">
              MLB
            </h1>

            <div className="mt-1 font-mono text-xs text-gray-600">
              {fixtureCount} games
              {lastUpdated
                ? ` · updated ${lastUpdated}`
                : ""}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(event) =>
                setSelectedDate(event.target.value)
              }
              className="border border-gray-800 bg-[#080808] px-3 py-2 font-mono text-xs text-gray-400 outline-none"
            />

            <button
              type="button"
              onClick={loadMLB}
              disabled={loading}
              className="border border-gray-800 bg-[#080808] px-3 py-2 font-mono text-xs text-gray-400 hover:border-gray-600 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "LOADING..." : "REFRESH"}
            </button>

            <button
              type="button"
              onClick={runAnalysis}
              disabled={analysisLoading || loading || analysisEvents.length > 0}
              className="border border-gray-800 bg-[#080808] px-3 py-2 font-mono text-xs text-gray-400 hover:border-gray-600 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {analysisLoading
                ? "ANALYZING..."
                : analysisEvents.length > 0
                  ? "ANALYSIS SAVED"
                  : "ANALYZE"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 border border-red-950 bg-[#0b0505] px-4 py-3 font-mono text-xs text-red-400">
            {error}
          </div>
        )}

        {analysisError && (
          <div className="mb-4 border border-yellow-950 bg-[#0a0904] px-4 py-3 font-mono text-xs text-yellow-600">
            {analysisError}
          </div>
        )}

        {betError && (
          <div className="mb-4 border border-red-950 bg-[#0b0505] px-4 py-3 font-mono text-xs text-red-400">
            {betError}
          </div>
        )}

        {selectedLeague === "mlb" && (
          <div className="overflow-hidden border border-gray-900 bg-[#050505]">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed border-collapse">
                <thead>
                  <tr className="border-b border-gray-900 bg-[#090909]">
                    <th className="w-[72px] px-3 py-3 text-left font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      TIME
                    </th>

                    <th className="w-[125px] px-3 py-3 text-left font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      AWAY
                    </th>

                    <th className="w-[125px] px-3 py-3 text-left font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      HOME
                    </th>

                    <th className="w-[68px] px-2 py-3 text-center font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      SCORE
                    </th>

                    <th className="w-[300px] px-3 py-3 text-left font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      PITCHERS
                    </th>

                    <th className="w-[125px] px-2 py-3 text-center font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      F3
                    </th>

                    <th className="w-[125px] px-2 py-3 text-center font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      F5
                    </th>

                    <th className="w-[125px] px-2 py-3 text-center font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      ML
                    </th>

                    <th className="w-[210px] px-3 py-3 text-left font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      SUGERENCIA
                    </th>

                    <th className="w-[88px] px-2 py-3 text-center font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      BET
                    </th>

                    <th className="w-[95px] px-3 py-3 text-right font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      STATUS
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {loading && (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-4 py-10 text-center font-mono text-xs text-gray-600"
                      >
                        Loading MLB data...
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    fixtures.length === 0 && (
                      <tr>
                        <td
                          colSpan={9}
                          className="px-4 py-10 text-center font-mono text-xs text-gray-600"
                        >
                          No games available.
                        </td>
                      </tr>
                    )}

                  {!loading &&
                    fixtures.map((game) => {
                      const oddsEvent =
                        findOddsEvent(
                          game,
                          oddsEvents
                        );

                      const f3Market = getMarket(
                        oddsEvent,
                        "F3_3WAY"
                      );

                      const f5Market = getMarket(
                        oddsEvent,
                        "F5_3WAY"
                      );

                      const mlMarket = getMarket(
                        oddsEvent,
                        "FULL_GAME_ML"
                      );

                      const score =
                        formatGameScore(game);

                      const expandedForGame =
                        expandedMarket?.gameId ===
                        game.id
                          ? expandedMarket.market
                          : null;

                      const renderMarketButton = (
                        marketKey: string,
                        market: OddsMarket | null
                      ) => {
                        const home =
                          getOutcomeSelection(
                            market,
                            "HOME"
                          );

                        const draw =
                          getOutcomeSelection(
                            market,
                            "DRAW"
                          );

                        const away =
                          getOutcomeSelection(
                            market,
                            "AWAY"
                          );

                        const hasOdds =
                          Boolean(
                            home ||
                              draw ||
                              away
                          );

                        return (
                          <button
                            type="button"
                            onClick={() =>
                              hasOdds &&
                              toggleMarket(
                                game.id,
                                marketKey
                              )
                            }
                            disabled={!hasOdds}
                            className={`w-full min-w-[110px] border px-2 py-2 text-left transition ${
                              hasOdds
                                ? "border-gray-900 bg-[#080808] hover:border-gray-700 hover:bg-[#0d0d0d]"
                                : "cursor-default border-transparent bg-transparent"
                            }`}
                          >
                            {!hasOdds ? (
                              <span className="font-mono text-xs text-gray-700">
                                —
                              </span>
                            ) : (
                              <div className="grid grid-cols-3 gap-1 font-mono text-[10px]">
                                <span className="text-center">
                                  <span className="block text-[8px] text-fuchsia-500">AWAY</span>
                                  <span className="text-fuchsia-400">{getCompactOdds(away)}</span>
                                </span>
                                <span className="text-center">
                                  <span className="block text-[8px] text-gray-700">DRAW</span>
                                  <span className="text-gray-500">{getCompactOdds(draw)}</span>
                                </span>
                                <span className="text-center">
                                  <span className="block text-[8px] text-blue-500">HOME</span>
                                  <span className="text-blue-400">{getCompactOdds(home)}</span>
                                </span>
                              </div>
                            )}
                          </button>
                        );
                      };

                      return (
                        <Fragment key={game.id}>
                          <tr className="border-b border-gray-900 hover:bg-[#080808]">
                            <td className="whitespace-nowrap px-4 py-4 align-top font-mono text-xs text-gray-500">
                              {game.time}
                            </td>

                            <td className="w-[125px] px-3 py-4 align-top">
                              <div className="flex items-start gap-2">
                                {game.awayTeam.logo && (
                                  <img src={game.awayTeam.logo} alt="" className="mt-0.5 h-5 w-5 shrink-0 object-contain" />
                                )}
                                {(() => {
                                  const team = formatTeamName(game.awayTeam.name);
                                  return (
                                    <span className="min-w-0 font-mono text-[11px] leading-tight text-gray-300">
                                      <span className="block truncate">{team.city}</span>
                                      <span className="block truncate text-fuchsia-300">{team.team}</span>
                                    </span>
                                  );
                                })()}
                              </div>
                            </td>

                            <td className="w-[125px] px-3 py-4 align-top">
                              <div className="flex items-start gap-2">
                                {game.homeTeam.logo && (
                                  <img src={game.homeTeam.logo} alt="" className="mt-0.5 h-5 w-5 shrink-0 object-contain" />
                                )}
                                {(() => {
                                  const team = formatTeamName(game.homeTeam.name);
                                  return (
                                    <span className="min-w-0 font-mono text-[11px] leading-tight text-gray-300">
                                      <span className="block truncate">{team.city}</span>
                                      <span className="block truncate text-blue-300">{team.team}</span>
                                    </span>
                                  );
                                })()}
                              </div>
                            </td>

                            <td className="px-4 py-4 text-center align-top">
                              {score ? (
                                <span
                                  className={`font-mono text-xs font-semibold ${
                                    isLiveStatus(
                                      game.status
                                    )
                                      ? "text-green-400"
                                      : "text-gray-300"
                                  }`}
                                >
                                  {score}
                                </span>
                              ) : (
                                <span className="font-mono text-xs text-gray-700">
                                  —
                                </span>
                              )}
                            </td>

<td className="w-[300px] px-3 py-4 align-top">
  <div className="space-y-1 font-mono text-[10px] leading-tight">
    <div className="text-gray-400">
      A:{" "}
      {formatPitcher(
        game.pitchers.away
      )}
    </div>

    <div className="text-gray-400">
      H:{" "}
      {formatPitcher(
        game.pitchers.home
      )}
    </div>
  </div>
</td>

                            <td className="px-3 py-3 align-top">
                              {renderMarketButton(
                                "F3_3WAY",
                                f3Market
                              )}
                            </td>

                            <td className="px-3 py-3 align-top">
                              {renderMarketButton(
                                "F5_3WAY",
                                f5Market
                              )}
                            </td>

                            <td className="px-3 py-3 align-top">
                              {renderMarketButton(
                                "FULL_GAME_ML",
                                mlMarket
                              )}
                            </td>

                            <td className="w-[210px] px-4 py-4 align-top">
                              {(() => {
                                const recommendation = getRecommendation(game);

                                if (!analysisEvents.length) {
                                  return <span className="font-mono text-[10px] text-gray-700">—</span>;
                                }

                                if (!recommendation?.evaluation) {
                                  return <span className="font-mono text-[10px] text-gray-600">NO BET</span>;
                                }

                                const evaluation = recommendation.evaluation;

                                return (
                                  <div className="min-w-0">
                                    <div className="font-mono text-[11px] text-gray-300">
                                      {MARKET_LABELS[recommendation.market] ?? recommendation.market} · {recommendation.selection}
                                    </div>
                                    <div className="mt-1 font-mono text-[10px] text-gray-600">
                                      EV {(evaluation.ev * 100).toFixed(1)}% · EDGE {(evaluation.edge * 100).toFixed(1)}% · {evaluation.grade}
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>

                            <td className="w-[88px] px-2 py-4 text-center align-middle">
                              {(() => {
                                const recommendation = getRecommendation(game);

                                if (!recommendation?.evaluation) {
                                  return <span className="font-mono text-[10px] text-gray-700">—</span>;
                                }

                                const busy = bettingEventId === game.id;
                                const accepted = acceptedBets.some(
                                  (bet) =>
                                    bet.eventId === recommendation.eventId &&
                                    bet.market === recommendation.market &&
                                    bet.selection === recommendation.selection,
                                );

                                return (
                                  <button
                                    type="button"
                                    disabled={busy || accepted}
                                    onClick={() => acceptBet(game, recommendation)}
                                    className="w-[78px] border border-gray-700 bg-[#090909] px-2 py-2 font-mono text-[9px] text-gray-300 hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    {busy ? "..." : accepted ? "BET SAVED" : "BET"}
                                  </button>
                                );
                              })()}
                            </td>

                            <td className="whitespace-nowrap px-4 py-4 text-right align-top">
                              <span
                                className={`font-mono text-[10px] ${getStatusClass(
                                  game.status
                                )}`}
                              >
                                {getStatusLabel(
                                  game.status
                                )}
                              </span>
                            </td>
                          </tr>

                          {expandedForGame && (
                            <tr className="border-b border-gray-800 bg-[#080808]">
                              <td
                                colSpan={10}
                                className="px-6 py-4"
                              >
                                {(() => {
                                  const selectedMarket =
                                    getMarket(
                                      oddsEvent,
                                      expandedForGame
                                    );

                                  if (
                                    !selectedMarket
                                  ) {
                                    return (
                                      <div className="font-mono text-xs text-gray-700">
                                        No bookmaker
                                        data.
                                      </div>
                                    );
                                  }

                                  const analysisEvent = analysisEvents.find(
                                    (item) => item.eventId === oddsEvent?.eventId,
                                  );
                                  const selectedAnalysis =
                                    analysisEvent?.markets.find(
                                      (market) => market.market === expandedForGame,
                                    );
                                  const recommendation = analysisEvent?.markets
                                    .filter((market) => market.evaluation?.decision === "BET")
                                    .filter((market) => Number.isFinite(market.marketOdds))
                                    .sort(
                                      (a, b) =>
                                        (b.evaluation?.ev ?? -Infinity) -
                                        (a.evaluation?.ev ?? -Infinity),
                                    )[0] ?? null;

                                  return (
                                    <div>
                                      {recommendation?.evaluation && (
                                        <div className="mb-5 border border-gray-900 bg-[#050505] px-4 py-4">
                                          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-gray-600">
                                            ANALYSIS / SUGGESTION
                                          </div>
                                          <div className="font-mono text-xs text-gray-200">
                                            {MARKET_LABELS[recommendation.market] ?? recommendation.market} · {recommendation.selection}
                                          </div>
                                          <div className="mt-2 font-mono text-[10px] text-gray-500">
                                            EV {(recommendation.evaluation.ev * 100).toFixed(1)}% · EDGE {(recommendation.evaluation.edge * 100).toFixed(1)}% · {recommendation.evaluation.grade}
                                          </div>
                                          {analysisEvent?.justification ? (
                                            <div className="mt-3 max-w-4xl">
                                              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-gray-600">
                                                WHY THIS BET
                                              </div>
                                              <div className="font-mono text-[11px] leading-relaxed text-gray-400">
                                                {analysisEvent.justification}
                                              </div>
                                            </div>
                                          ) : null}
                                        </div>
                                      )}

                                      {selectedAnalysis?.evaluation && (
                                        <div className="mb-5 font-mono text-[10px] text-gray-600">
                                          {MARKET_LABELS[expandedForGame] ?? expandedForGame}: estimated {(selectedAnalysis.evaluation.estimatedProbability * 100).toFixed(1)}% · implied {(selectedAnalysis.evaluation.impliedProbability * 100).toFixed(1)}% · edge {(selectedAnalysis.evaluation.edge * 100).toFixed(1)}% · EV {(selectedAnalysis.evaluation.ev * 100).toFixed(1)}%
                                        </div>
                                      )}

                                      <div className="mb-3 flex items-center justify-between">
                                        <div className="font-mono text-[10px] uppercase tracking-wider text-gray-600">
                                          {
                                            MARKET_LABELS[
                                              expandedForGame
                                            ]
                                          }{" "}
                                          BOOKMAKER
                                          ODDS
                                        </div>

                                        <div className="font-mono text-[10px] text-gray-700">
                                          AWAY
                                          {" / "}
                                          DRAW
                                          {" / "}
                                          HOME
                                        </div>
                                      </div>

                                      <div className="space-y-1">
                                        {selectedMarket.selections.map(
                                          (
                                            selection
                                          ) => (
                                            <div
                                              key={`${game.id}-${expandedForGame}-${selection.outcome}`}
                                              className="grid grid-cols-[180px_1fr] gap-4 border-t border-gray-900 py-2 first:border-t-0"
                                            >
                                              <div className="font-mono text-[11px] text-gray-500">
                                                {selection.selection}
                                              </div>

                                              <div className="flex flex-wrap gap-x-5 gap-y-1">
                                                {selection.bookmakers.map(
                                                  (
                                                    bookmaker
                                                  ) => (
                                                    <div
                                                      key={`${bookmaker.bookmakerKey}-${bookmaker.price}`}
                                                      className={`font-mono text-[11px] ${getBookmakerClass(
                                                        bookmaker
                                                      )}`}
                                                    >
                                                      {
                                                        bookmaker.bookmakerTitle
                                                      }{" "}
                                                      <span>
                                                        {truncateToTwoDecimals(
                                                          bookmaker.price
                                                        )}
                                                      </span>
                                                    </div>
                                                  )
                                                )}
                                              </div>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

          <div className="mt-4 border-t border-gray-900 pt-4 font-mono text-[10px] leading-relaxed text-gray-600">
            <div className="mb-1 uppercase tracking-wider text-gray-700">LEGEND</div>
            <div>Market odds = median reference bookmaker price.</div>
            <div>EV — Expected Value: estimated return advantage based on the model probability and available odds.</div>
            <div>EDGE — Difference between the model estimated probability and the market implied probability.</div>
            <div>ERA — Earned Run Average: earned runs allowed per 9 innings.</div>
            <div>WHIP — Walks + Hits per Inning Pitched: walks and hits allowed per inning.</div>
            <div className="mt-1">Click F3, F5 or ML to view bookmaker detail.</div>
          </div>
        </section>
      )}
    </main>
  );
}