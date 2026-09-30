export type BetGrade = "⭐⭐⭐" | "⭐⭐" | "⭐" | "NO BET";
export type BetDecision = "BET" | "NO BET";

export type BettingInput = {
  estimatedProbability: number;
  odds: number;
  confidence: number;
  uncertaintyPenalty?: number;
};

export type BettingResult = {
  estimatedProbability: number;
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
  if (!Number.isFinite(odds) || odds <= 1) {
    throw new Error("Odds must be greater than 1");
  }

  return 1 / odds;
}

export function calculateEdge(
  estimatedProbability: number,
  impliedProbability: number,
): number {
  return estimatedProbability - impliedProbability;
}

export function calculateEV(
  estimatedProbability: number,
  odds: number,
): number {
  return estimatedProbability * odds - 1;
}

function getGrade(
  ev: number,
  edge: number,
  confidence: number,
): BetGrade {
  const evPct = ev * 100;
  const edgePct = edge * 100;

  if (
    evPct >= 5 &&
    edgePct >= 6 &&
    confidence >= 80
  ) {
    return "⭐⭐⭐";
  }

  if (
    evPct >= 5 &&
    edgePct >= 5 &&
    confidence >= 70
  ) {
    return "⭐⭐";
  }

  if (
    evPct >= 3 &&
    confidence >= 60
  ) {
    return "⭐";
  }

  return "NO BET";
}

function calculateUnits(grade: BetGrade): number {
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
  input: BettingInput,
): BettingResult {
  const {
    estimatedProbability,
    odds,
    confidence,
    uncertaintyPenalty = 0,
  } = input;

  if (
    !Number.isFinite(estimatedProbability) ||
    estimatedProbability < 0 ||
    estimatedProbability > 1
  ) {
    throw new Error(
      "Estimated probability must be between 0 and 1",
    );
  }

  if (!Number.isFinite(confidence)) {
    throw new Error("Confidence must be a number");
  }

  const impliedProbability =
    calculateImpliedProbability(odds);

  const rawEdge = calculateEdge(
    estimatedProbability,
    impliedProbability,
  );

  const rawEV = calculateEV(
    estimatedProbability,
    odds,
  );

  const adjustedConfidence = Math.max(
    0,
    Math.min(100, confidence - uncertaintyPenalty),
  );

  const grade = getGrade(
    rawEV,
    rawEdge,
    adjustedConfidence,
  );

  const decision: BetDecision =
    grade === "NO BET" ? "NO BET" : "BET";

  return {
    estimatedProbability: round(estimatedProbability),
    impliedProbability: round(impliedProbability),
    edge: round(rawEdge),
    ev: round(rawEV),
    confidence: round(adjustedConfidence, 2),
    grade,
    decision,
    units: calculateUnits(grade),
  };
}
