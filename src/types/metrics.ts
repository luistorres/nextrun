/**
 * Health metrics type definitions.
 */

export interface MetricsBaseline {
  /** 28-day rolling averages */
  hrvAvg: number | null;
  sleepScoreAvg: number | null;
  restingHRAvg: number | null;
  stressAvg: number | null;
  bodyBatteryStartAvg: number | null;
  vo2MaxAvg: number | null;
  /** Date range this baseline covers */
  fromDate: string;
  toDate: string;
  /** Number of data points used */
  dataPoints: number;
}

export type TrendDirection = "up" | "down" | "stable";

export interface MetricsTrend {
  metric: string;
  current7dAvg: number;
  baseline28dAvg: number;
  direction: TrendDirection;
  /** Percentage change from baseline */
  changePercent: number;
  /** Whether this change is concerning */
  flag: "positive" | "negative" | "neutral";
}

export interface HealthSnapshot {
  date: string;
  restingHR: number | null;
  hrvLastNight: number | null;
  sleepScore: number | null;
  sleepDurationHours: number | null;
  avgStress: number | null;
  bodyBatteryStart: number | null;
  bodyBatteryEnd: number | null;
  vo2Max: number | null;
  steps: number | null;
}

export interface TrainingLoadSummary {
  weekStartDate: string;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  workoutsCompleted: number;
  workoutsPlanned: number;
  workoutsMissed: number;
  avgAerobicTrainingEffect: number | null;
  avgAnaerobicTrainingEffect: number | null;
  intensityDistribution: {
    easy: number;
    moderate: number;
    hard: number;
  };
  /** Foster (1998) RPE session load: sum(RPE × duration_min) for the week */
  sessionRpeLoad: number | null;
  /** Average RPE score (1–10) across completed sessions this week */
  avgRpeScore: number | null;
  /** Number of sessions with RPE data this week */
  rpeDataPoints: number;
}
