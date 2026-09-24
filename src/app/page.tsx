"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";

const VALID_USERNAME = "admin";
const VALID_PASSWORD = "P4$$w0rd26!";

type PitcherStats = {
  era: number | null;
  whip: number | null;
  wins: number | null;
  losses: number | null;
};

type Pitcher = {
  id: number;
  name: string;
  stats: PitcherStats | null;
};

type Team = {
  id: number;
  name: string;
  logo: string;
  score: number | null;
};

type MLBMatch = {
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

type OddsOutcome = "HOME" | "DRAW" | "AWAY";

type OddsBookmaker = {
  bookmakerKey: string;
  bookmakerTitle: string;
  price: number;
  isHighest: boolean;
  isLowest: boolean;
};

type OddsSelection = {
  outcome: OddsOutcome;
  team: string | null;
  marketOdds: number;
  minimumOdds: number;
  maximumOdds: number;
  bookmakers: OddsBookmaker[];
};

type OddsMarket = {
  market: "F3_3WAY" | "F5_3WAY";
  selections: OddsSelection[];
};

type OddsEvent = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  markets: OddsMarket[];
};

type OddsResponse = {
  success?: boolean;
  snapshotDate?: string;
  totalRows?: number;
  totalEvents?: number;
  events?: OddsEvent[];
};

function truncateToTwoDecimals(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2);
}

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function getMarketOdds(
  oddsEvent: OddsEvent | undefined,
  marketName: "F3_3WAY" | "F5_3WAY"
) {
  return oddsEvent?.markets.find(
    (market) => market.market === marketName
  );
}

function findSelection(
  market: OddsMarket | undefined,
  outcome: OddsOutcome
): OddsSelection | undefined {
  return market?.selections.find(
    (selection) => selection.outcome === outcome
  );
}

function findOddsEvent(
  oddsEvents: OddsEvent[],
  game: MLBMatch
): OddsEvent | undefined {
  const home = normalizeTeamName(game.homeTeam.name);
  const away = normalizeTeamName(game.awayTeam.name);

  return oddsEvents.find(
    (event) =>
      normalizeTeamName(event.homeTeam) === home &&
      normalizeTeamName(event.awayTeam) === away
  );
}

function BookmakerReference({
  selection,
}: {
  selection: OddsSelection | undefined;
}) {
  if (!selection || selection.bookmakers.length === 0) {
    return (
      <div className="mt-2 text-[10px] text-zinc-600">
        REFERENCE ONLY: NO BOOKMAKER DATA
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] text-zinc-600">
        REFERENCE ONLY
      </div>

      <div className="space-y-0.5 text-[10px]">
        {selection.bookmakers.map((bookmaker) => (
          <div
            key={`${bookmaker.bookmakerKey}-${selection.outcome}`}
            className="flex items-center justify-between gap-3"
          >
            <span className="truncate text-zinc-500">
              {bookmaker.bookmakerTitle}
            </span>

            <span
              className={
                bookmaker.isHighest
                  ? "text-green-400"
                  : bookmaker.isLowest
                    ? "text-red-400"
                    : "text-zinc-500"
              }
            >
              {truncateToTwoDecimals(bookmaker.price)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketOddsBlock({
  market,
  homeTeam,
  awayTeam,
}: {
  market: OddsMarket | undefined;
  homeTeam: string;
  awayTeam: string;
}) {
  if (!market) {
    return (
      <div className="text-xs text-zinc-700">
        —
      </div>
    );
  }

  const homeSelection = findSelection(market, "HOME");
  const drawSelection = findSelection(market, "DRAW");
  const awaySelection = findSelection(market, "AWAY");

  return (
    <div className="min-w-[230px]">
      <div className="mb-2 text-[10px] text-zinc-500">
        {market.market === "F3_3WAY" ? "F3 3-WAY" : "F5 3-WAY"}
      </div>

      <div className="space-y-3">
        {homeSelection && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-xs text-zinc-300">
                {homeTeam}
              </span>

              <span className="font-semibold text-zinc-100">
                {truncateToTwoDecimals(homeSelection.marketOdds)}
              </span>
            </div>

            <BookmakerReference selection={homeSelection} />
          </div>
        )}

        {drawSelection && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-500">
                DRAW
              </span>

              <span className="font-semibold text-zinc-100">
                {truncateToTwoDecimals(drawSelection.marketOdds)}
              </span>
            </div>

            <BookmakerReference selection={drawSelection} />
          </div>
        )}

        {awaySelection && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-xs text-zinc-300">
                {awayTeam}
              </span>

              <span className="font-semibold text-zinc-100">
                {truncateToTwoDecimals(awaySelection.marketOdds)}
              </span>
            </div>

            <BookmakerReference selection={awaySelection} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [authenticated, setAuthenticated] = useState(false);

  const [sport, setSport] = useState<"MLB" | "NFL">("MLB");

  const [games, setGames] = useState<MLBMatch[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [gamesError, setGamesError] = useState("");

  const [oddsEvents, setOddsEvents] = useState<OddsEvent[]>([]);
  const [loadingOdds, setLoadingOdds] = useState(false);
  const [oddsError, setOddsError] = useState("");

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      username === VALID_USERNAME &&
      password === VALID_PASSWORD
    ) {
      setError("");
      setAuthenticated(true);
      return;
    }

    setError("ACCESS DENIED");
  };

  useEffect(() => {
    if (!authenticated || sport !== "MLB") {
      return;
    }

    const loadGames = async () => {
      try {
        setLoadingGames(true);
        setGamesError("");

        const response = await fetch("/api/fixtures/mlb");

        if (!response.ok) {
          throw new Error("Unable to retrieve MLB data.");
        }

        const data = await response.json();

        setGames(data.matches ?? []);
      } catch (error) {
        console.error(error);
        setGamesError("MLB DATA ERROR");
        setGames([]);
      } finally {
        setLoadingGames(false);
      }
    };

    loadGames();
  }, [authenticated, sport]);

  useEffect(() => {
    if (!authenticated || sport !== "MLB") {
      return;
    }

    const loadOdds = async () => {
      try {
        setLoadingOdds(true);
        setOddsError("");

        const response = await fetch("/api/odds-test/mlb");

        if (!response.ok) {
          throw new Error("Unable to retrieve MLB odds.");
        }

        const data: OddsResponse = await response.json();

        setOddsEvents(data.events ?? []);
      } catch (error) {
        console.error(error);
        setOddsError("ODDS DATA ERROR");
        setOddsEvents([]);
      } finally {
        setLoadingOdds(false);
      }
    };

    loadOdds();
  }, [authenticated, sport]);

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-black p-6 font-mono text-green-500">
        <div className="mx-auto mt-24 w-full max-w-3xl">
          <div className="mb-10">
            <p>C:\SYSTEM\ACCESS</p>
            <p>------------------------------------------</p>
            <p className="mt-2">SECURE TERMINAL</p>
            <p>READY.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="flex">
              <span>USER:&nbsp;&nbsp;</span>

              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setError("");
                }}
                autoComplete="username"
                autoFocus
                className="w-64 border-none bg-transparent p-0 text-green-500 caret-green-500 outline-none"
              />
            </div>

            <div className="flex">
              <span>PASS:&nbsp;&nbsp;</span>

              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                autoComplete="current-password"
                className="w-64 border-none bg-transparent p-0 text-green-500 caret-green-500 outline-none"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="border border-green-500 px-4 py-1 text-green-500 hover:bg-green-500 hover:text-black"
              >
                [ AUTHENTICATE ]
              </button>
            </div>

            {error && (
              <p className="mt-4 text-red-500">
                {error}
              </p>
            )}
          </form>

          <div className="mt-16">
            <p>STATUS: ONLINE</p>
            <p>TERMINAL: LOCAL</p>
            <p className="mt-2 animate-pulse">_</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-200">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="flex h-20 items-center justify-between px-6">
          <div className="flex h-full items-center">
            <Image
              src="/appuestas-logo.png"
              alt="APPuestas"
              width={220}
              height={55}
              className="h-14 w-auto object-contain"
              priority
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSport("MLB")}
              className={`px-4 py-2 text-sm font-mono ${
                sport === "MLB"
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              MLB
            </button>

            <button
              disabled
              className="cursor-not-allowed px-4 py-2 text-sm font-mono text-zinc-700"
            >
              NFL
            </button>
          </div>
        </div>
      </header>

      <div className="p-6">
        <div className="mb-6">
          <h1 className="font-mono text-lg">
            {sport} // GAMES
          </h1>

          <div className="mt-1 flex items-center gap-3 font-mono text-xs">
            <span className="text-zinc-500">
              LIVE DATA
            </span>

            {loadingOdds && (
              <span className="text-zinc-600">
                ODDS LOADING...
              </span>
            )}

            {!loadingOdds && !oddsError && oddsEvents.length > 0 && (
              <span className="text-green-600">
                ODDS READY
              </span>
            )}

            {oddsError && (
              <span className="text-red-500">
                {oddsError}
              </span>
            )}
          </div>
        </div>

        {loadingGames && (
          <div className="border border-zinc-800 p-6 font-mono text-sm text-zinc-500">
            LOADING MLB DATA...
          </div>
        )}

        {gamesError && (
          <div className="border border-red-900 bg-red-950/20 p-6 font-mono text-sm text-red-500">
            {gamesError}
          </div>
        )}

        {!loadingGames && !gamesError && (
          <div className="overflow-x-auto border border-zinc-800">
            <table className="w-full min-w-[1700px] border-collapse text-left font-mono text-sm">
              <thead className="bg-zinc-900 text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3">TIME</th>
                  <th className="px-4 py-3">AWAY</th>
                  <th className="px-4 py-3">HOME</th>
                  <th className="px-4 py-3">PITCHERS</th>
                  <th className="px-4 py-3">F3 MARKET ODDS</th>
                  <th className="px-4 py-3">F5 MARKET ODDS</th>
                  <th className="px-4 py-3">STATUS</th>
                  <th className="px-4 py-3">PARLAY</th>
                </tr>
              </thead>

              <tbody>
                {games.map((game) => {
                  const isPostponed =
                    game.status.toLowerCase() === "postponed";

                  const isFinished =
                    game.status.toLowerCase() === "final";

                  const oddsEvent = findOddsEvent(
                    oddsEvents,
                    game
                  );

                  const f3Market = getMarketOdds(
                    oddsEvent,
                    "F3_3WAY"
                  );

                  const f5Market = getMarketOdds(
                    oddsEvent,
                    "F5_3WAY"
                  );

                  return (
                    <tr
                      key={game.id}
                      className={`border-t border-zinc-800 ${
                        isPostponed
                          ? "opacity-40"
                          : "hover:bg-zinc-900"
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-4">
                        {game.time}
                      </td>

                      <td className="px-4 py-4">
                        {game.awayTeam.name}
                      </td>

                      <td className="px-4 py-4">
                        {game.homeTeam.name}
                      </td>

                      <td className="px-4 py-4 text-xs">
                        <div>
                          <span className="text-zinc-400">
                            {game.awayTeam.name}:
                          </span>{" "}
                          {game.pitchers.away?.name ?? "TBD"}
                        </div>

                        <div className="mt-1">
                          <span className="text-zinc-400">
                            {game.homeTeam.name}:
                          </span>{" "}
                          {game.pitchers.home?.name ?? "TBD"}
                        </div>
                      </td>

                      <td className="px-4 py-4 align-top">
                        <MarketOddsBlock
                          market={f3Market}
                          homeTeam={game.homeTeam.name}
                          awayTeam={game.awayTeam.name}
                        />
                      </td>

                      <td className="px-4 py-4 align-top">
                        <MarketOddsBlock
                          market={f5Market}
                          homeTeam={game.homeTeam.name}
                          awayTeam={game.awayTeam.name}
                        />
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={
                            isFinished
                              ? "text-zinc-500"
                              : isPostponed
                                ? "text-red-500"
                                : "text-green-400"
                          }
                        >
                          {game.status.toUpperCase()}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <span className="text-zinc-600">
                          —
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}