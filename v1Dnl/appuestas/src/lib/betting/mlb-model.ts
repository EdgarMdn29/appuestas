export type MlbPitcherStats = {
  era: number | null;
  whip: number | null;
  wins: number | null;
  losses: number | null;
};

export type MlbPitcher = {
  stats: MlbPitcherStats;
};

export type MlbPitcherPair = {
  home: MlbPitcher | null;
  away: MlbPitcher | null;
};

export type MlbPhase = "REGULAR_SEASON" | "PLAYOFFS";

export type MlbProbability = {
  homeProbability: number;
  awayProbability: number;
  confidence: number;
  source: "MLB_V1_PITCHER_MODEL";
};

export type MlbThreeWayProbability = {
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  confidence: number;
  source: "MLB_V1_THREE_WAY_PITCHER_MODEL";
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function pitcherRating(pitcher: MlbPitcher | null) {
  if (!pitcher) return null;

  const { era, whip, wins, losses } = pitcher.stats;
  if (era == null || whip == null) return null;

  const eraComponent = clamp((4.30 - era) / 1.50, -1, 1);
  const whipComponent = clamp((1.32 - whip) / 0.30, -1, 1);

  const decisions = (wins ?? 0) + (losses ?? 0);
  const winPct = decisions > 0 ? (wins ?? 0) / decisions : 0.5;
  const recordComponent = clamp((winPct - 0.5) / 0.25, -1, 1);

  return eraComponent * 0.60 + whipComponent * 0.30 + recordComponent * 0.10;
}

function pitcherRunFactor(pitcher: MlbPitcher | null) {
  if (!pitcher) return null;

  const { era, whip } = pitcher.stats;
  if (era == null || whip == null) return null;

  const eraFactor = clamp(era / 4.30, 0.55, 1.60);
  const whipFactor = clamp(whip / 1.30, 0.65, 1.50);

  return eraFactor * 0.70 + whipFactor * 0.30;
}

function homeFieldFactor(phase: MlbPhase) {
  // The postseason factor is intentionally only slightly stronger than the
  // regular-season factor. MLB reports 54.7% historical postseason home wins,
  // so this is a modest context adjustment rather than a large boost.
  return phase === "PLAYOFFS" ? 1.035 : 1.025;
}

function confidenceForPitchers(pitchers: MlbPitcherPair, ratingGap: number) {
  const homeComplete = pitcherRating(pitchers.home) != null;
  const awayComplete = pitcherRating(pitchers.away) != null;

  if (!homeComplete && !awayComplete) return 30;
  if (!homeComplete || !awayComplete) return 45;

  return clamp(60 + ratingGap * 15, 60, 72);
}

export function estimateMlbMoneylineProbability(
  pitchers: MlbPitcherPair,
  phase: MlbPhase = "REGULAR_SEASON",
): MlbProbability {
  const homeRating = pitcherRating(pitchers.home);
  const awayRating = pitcherRating(pitchers.away);

  if (homeRating == null && awayRating == null) {
    return { homeProbability: 0.5, awayProbability: 0.5, confidence: 30, source: "MLB_V1_PITCHER_MODEL" };
  }

  if (homeRating == null || awayRating == null) {
    return { homeProbability: 0.5, awayProbability: 0.5, confidence: 45, source: "MLB_V1_PITCHER_MODEL" };
  }

  const homeAdvantage = phase === "PLAYOFFS" ? 0.19 : 0.17;
  const logit = (homeRating - awayRating) * 0.95 + homeAdvantage;
  const homeProbability = clamp(1 / (1 + Math.exp(-logit)), 0.20, 0.80);
  const ratingGap = Math.abs(homeRating - awayRating);

  return {
    homeProbability,
    awayProbability: 1 - homeProbability,
    confidence: confidenceForPitchers(pitchers, ratingGap),
    source: "MLB_V1_PITCHER_MODEL",
  };
}

function poissonProbability(lambda: number, runs: number) {
  let probability = Math.exp(-lambda);
  for (let i = 1; i <= runs; i += 1) probability *= lambda / i;
  return probability;
}

function threeWayFromRunRates(homeLambda: number, awayLambda: number) {
  let home = 0;
  let draw = 0;
  let away = 0;

  const maxRuns = 20;
  for (let homeRuns = 0; homeRuns <= maxRuns; homeRuns += 1) {
    const homeProbability = poissonProbability(homeLambda, homeRuns);
    for (let awayRuns = 0; awayRuns <= maxRuns; awayRuns += 1) {
      const joint = homeProbability * poissonProbability(awayLambda, awayRuns);
      if (homeRuns > awayRuns) home += joint;
      else if (homeRuns === awayRuns) draw += joint;
      else away += joint;
    }
  }

  const total = home + draw + away;
  return {
    homeProbability: home / total,
    drawProbability: draw / total,
    awayProbability: away / total,
  };
}

export function estimateMlbThreeWayProbability(
  pitchers: MlbPitcherPair,
  innings: 3 | 5,
  phase: MlbPhase = "REGULAR_SEASON",
): MlbThreeWayProbability {
  const homeRunFactor = pitcherRunFactor(pitchers.home);
  const awayRunFactor = pitcherRunFactor(pitchers.away);

  if (homeRunFactor == null || awayRunFactor == null) {
    return {
      homeProbability: 1 / 3,
      drawProbability: 1 / 3,
      awayProbability: 1 / 3,
      confidence: confidenceForPitchers(pitchers, 0),
      source: "MLB_V1_THREE_WAY_PITCHER_MODEL",
    };
  }

  const neutralRunsPerGame = 4.30;
  const inningsFactor = innings / 9;
  const homeLambda = neutralRunsPerGame * inningsFactor * awayRunFactor * homeFieldFactor(phase);
  const awayLambda = neutralRunsPerGame * inningsFactor * homeRunFactor;

  const probabilities = threeWayFromRunRates(homeLambda, awayLambda);
  const homeRating = pitcherRating(pitchers.home) ?? 0;
  const awayRating = pitcherRating(pitchers.away) ?? 0;

  return {
    ...probabilities,
    confidence: confidenceForPitchers(pitchers, Math.abs(homeRating - awayRating)),
    source: "MLB_V1_THREE_WAY_PITCHER_MODEL",
  };
}
