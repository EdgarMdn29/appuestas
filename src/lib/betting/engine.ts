export type BetGrade = "⭐⭐⭐" | "⭐⭐" | "⭐" | "NO BET";

export type BetDecision = "BET" | "NO BET";

export type BettingInput = {
  estimatedProbability: number;
  odds: number;
  confidence: number;
  uncertaintyPenalty?: number;
};

export type BettingResult = {
  impliedProbability: number;
  edge: number;
  ev: number;
  confidence: number;
  grade: BetGrade;
  decision: BetDecision;
  units: number;
};

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateImpliedProbability(odds: number): number {
  if (odds <= 1) {
    throw new Error("Odds must be greater than 1.");
  }

  return 1 / odds;
}

export function calculateEdge(
  estimatedProbability: number,
  impliedProbability: number
): number {
  return estimatedProbability - impliedProbability;
}

export function calculateEV(
  estimatedProbability: number,
  odds: number
): number {
  return estimatedProbability * odds - 1;
}

function getGrade(
  ev: number,
  edge: number,
  confidence: number
): BetGrade {
  const evPct = ev * 100;
  const edgePct = edge * 100;

  if (
    evPct >= 5 &&
    edgePct >= 6 &&
    confidence >= 90
  ) {
    return "⭐⭐⭐";
  }

  if (
    evPct >= 5 &&
    edgePct >= 5 &&
    confidence >= 80
  ) {
    return "⭐⭐";
  }

  if (
    evPct >= 3 &&
    confidence >= 70
  ) {
    return "⭐";
  }

  return "NO BET";
}

function calculateUnits(
  grade: BetGrade
): number {
  switch (grade) {
    case "⭐⭐⭐":
      return 1.5;

    case "⭐⭐":
      return 1;

    case "⭐":
      return 0.5;

    default:
      return 0;
  }
}

export function evaluateBet(
  input: BettingInput
): BettingResult {
  const {
    estimatedProbability,
    odds,
    confidence,
    uncertaintyPenalty = 0,
  } = input;

  if (
    estimatedProbability < 0 ||
    estimatedProbability > 1
  ) {
    throw new Error(
      "Estimated probability must be between 0 and 1."
    );
  }

  if (confidence < 0 || confidence > 100) {
    throw new Error(
      "Confidence must be between 0 and 100."
    );
  }

  const impliedProbability =
    calculateImpliedProbability(odds);

  const edge = calculateEdge(
    estimatedProbability,
    impliedProbability
  );

  const ev = calculateEV(
    estimatedProbability,
    odds
  );

  const adjustedConfidence = Math.max(
    0,
    confidence - uncertaintyPenalty
  );

  let grade = getGrade(
    ev,
    edge,
    adjustedConfidence
  );

  // Hard NO BET filters.
  if (
    ev < 0.03 ||
    edge < 0.04 ||
    adjustedConfidence < 70
  ) {
    grade = "NO BET";
  }

  const units = calculateUnits(grade);

  return {
    impliedProbability: round(impliedProbability),
    edge: round(edge),
    ev: round(ev),
    confidence: round(adjustedConfidence, 2),
    grade,
    decision: grade === "NO BET" ? "NO BET" : "BET",
    units,
  };
}