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

export type MlbProbability = {
  homeProbability: number;
  awayProbability: number;
  confidence: number;
  source: "MLB_V1_PITCHER_MODEL";
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

  return (
    eraComponent * 0.60 +
    whipComponent * 0.30 +
    recordComponent * 0.10
  );
}

export function estimateMlbMoneylineProbability(
  pitchers: MlbPitcherPair,
): MlbProbability {
  const homeRating = pitcherRating(pitchers.home);
  const awayRating = pitcherRating(pitchers.away);

  if (homeRating == null && awayRating == null) {
    return {
      homeProbability: 0.5,
      awayProbability: 0.5,
      confidence: 30,
      source: "MLB_V1_PITCHER_MODEL",
    };
  }

  if (homeRating == null || awayRating == null) {
    return {
      homeProbability: 0.5,
      awayProbability: 0.5,
      confidence: 45,
      source: "MLB_V1_PITCHER_MODEL",
    };
  }

  // Modest home-field advantage.
  const logit = (homeRating - awayRating) * 0.95 + 0.08;

  // Keep probabilities conservative while the model only uses
  // pitcher-level information.
  const homeProbability = clamp(
    1 / (1 + Math.exp(-logit)),
    0.20,
    0.80,
  );

  const awayProbability = 1 - homeProbability;

  const ratingGap = Math.abs(homeRating - awayRating);

  // Confidence reflects the amount of information available,
  // not how large the model's probability happens to be.
  const confidence = clamp(
    60 + ratingGap * 15,
    60,
    72,
  );

  return {
    homeProbability,
    awayProbability,
    confidence,
    source: "MLB_V1_PITCHER_MODEL",
  };
}