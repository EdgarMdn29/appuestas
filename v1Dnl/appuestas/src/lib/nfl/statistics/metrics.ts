export const NFL_STATISTICAL_METRIC_SOURCES = {
  passing_epa: ["team_stats.passing_epa"],
  rushing_epa: ["team_stats.rushing_epa"],
  offensive_epa: ["team_stats.passing_epa", "team_stats.rushing_epa"],
  passing_epa_allowed: ["opponent.team_stats.passing_epa"],
  rushing_epa_allowed: ["opponent.team_stats.rushing_epa"],
  completion_rate: ["team_stats.completions", "team_stats.attempts"],
  passing_yards_per_attempt: ["team_stats.passing_yards", "team_stats.attempts"],
  rushing_yards_per_carry: ["team_stats.rushing_yards", "team_stats.carries"],
  turnovers: ["team_stats.passing_interceptions", "team_stats.fumbles_lost_total"],
  sack_rate_allowed: ["team_stats.sacks_suffered", "team_stats.attempts"],
} as const;

export const NFL_UNAVAILABLE_METRICS = {
  turnover_rate: "No possession or drive denominator is present in the selected snapshots.",
  red_zone_efficiency: "Red-zone attempts and scores are absent from the selected snapshots.",
  third_down_efficiency: "Third-down attempts and conversions are absent from the selected snapshots.",
  points_per_drive: "Drive-level points and drive counts are absent from the selected snapshots.",
  yards_per_drive: "Drive-level yards and drive counts are absent from the selected snapshots.",
  pressure: "Pressure and hurry counts are absent; sacks and QB hits are not equivalent to pressure.",
  hurries: "Hurry counts are absent from the selected snapshots.",
  starting_quarterback: "The snapshots do not reliably identify the future starting quarterback.",
  player_availability: "Injury and availability reports are not part of the selected snapshots.",
} as const;
