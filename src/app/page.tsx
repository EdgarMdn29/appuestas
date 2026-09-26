"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
} from "react";

type League = "mlb" | "nfl";

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

type ExpandedMarket = {
  gameId: string;
  market: string;
} | null;

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

  const [selectedLeague, setSelectedLeague] =
    useState<League>("mlb");

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

  async function loadMLB() {
    setLoading(true);
    setError("");
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

  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }

    if (selectedLeague !== "mlb") {
      return;
    }

    loadMLB();
  }, [isLoggedIn, selectedLeague, selectedDate]);

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
              onClick={() =>
                setSelectedLeague("mlb")
              }
              className={`border px-4 py-2 font-mono text-xs transition ${
                selectedLeague === "mlb"
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
          </div>
        </div>

        {error && (
          <div className="mb-4 border border-red-950 bg-[#0b0505] px-4 py-3 font-mono text-xs text-red-400">
            {error}
          </div>
        )}

        {selectedLeague === "mlb" && (
          <div className="overflow-hidden border border-gray-900 bg-[#050505]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1470px] border-collapse">
                <thead>
                  <tr className="border-b border-gray-900 bg-[#090909]">
                    <th className="px-4 py-3 text-left font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      TIME
                    </th>

                    <th className="px-4 py-3 text-left font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      AWAY
                    </th>

                    <th className="px-4 py-3 text-left font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      HOME
                    </th>

                    <th className="px-4 py-3 text-center font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      SCORE
                    </th>

                    <th className="px-4 py-3 text-left font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      PITCHERS
                    </th>

                    <th className="px-4 py-3 text-center font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      F3
                    </th>

                    <th className="px-4 py-3 text-center font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      F5
                    </th>

                    <th className="px-4 py-3 text-center font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      ML
                    </th>

                    <th className="px-4 py-3 text-right font-mono text-[10px] font-normal tracking-wider text-gray-600">
                      STATUS
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {loading && (
                    <tr>
                      <td
                        colSpan={9}
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
                              <div className="flex items-center justify-center gap-3 font-mono text-xs">
                                <span className="text-gray-300">
                                  {getCompactOdds(
                                    away
                                  )}
                                </span>

                                {draw && (
                                  <span className="text-gray-500">
                                    {getCompactOdds(
                                      draw
                                    )}
                                  </span>
                                )}

                                <span className="text-gray-300">
                                  {getCompactOdds(
                                    home
                                  )}
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

                            <td className="px-4 py-4 align-top">
                              <div className="flex items-center gap-2">
                                {game.awayTeam.logo && (
                                  <img
                                    src={
                                      game.awayTeam
                                        .logo
                                    }
                                    alt=""
                                    className="h-5 w-5 object-contain"
                                  />
                                )}

                                <span className="font-mono text-xs text-gray-300">
                                  {
                                    game.awayTeam
                                      .name
                                  }
                                </span>
                              </div>
                            </td>

                            <td className="px-4 py-4 align-top">
                              <div className="flex items-center gap-2">
                                {game.homeTeam.logo && (
                                  <img
                                    src={
                                      game.homeTeam
                                        .logo
                                    }
                                    alt=""
                                    className="h-5 w-5 object-contain"
                                  />
                                )}

                                <span className="font-mono text-xs text-gray-300">
                                  {
                                    game.homeTeam
                                      .name
                                  }
                                </span>
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

<td className="w-[440px] min-w-[440px] px-4 py-4 align-top">
  <div className="space-y-1 font-mono text-[11px]">
    <div className="whitespace-nowrap text-gray-400">
      A:{" "}
      {formatPitcher(
        game.pitchers.away
      )}
    </div>

    <div className="whitespace-nowrap text-gray-400">
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
                                colSpan={9}
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

                                  return (
                                    <div>
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

        <div className="mt-4 font-mono text-[10px] text-gray-700">
          Market odds = median reference bookmaker price.
          Click F3, F5 or ML to view bookmaker detail.
        </div>
      </section>
    </main>
  );
}