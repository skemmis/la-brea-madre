/**
 * Pure logic for building a "fines over/under" round from the historical
 * daily series. No IO — the line, opening odds, and resolved outcome are all
 * deterministic functions of the data, so they're unit-testable anywhere.
 */
import type { DailyAggregate } from "./citationAggregate";

export const OVER_UNDER_OUTCOMES = ["OVER", "UNDER"] as const;

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export interface OverUnderRound {
  line: number; // the over/under threshold (median of trailing days)
  baseRateOver: number; // opening probability of OVER
  actualFine: number; // the hidden truth for the target day
  outcomeIndex: number; // 0 = OVER, 1 = UNDER
  outcomes: string[];
}

/**
 * Build an over/under round for `targetDate` using the trailing `window` days
 * as reference. The line is the median of trailing fines (so it's a genuine
 * toss-up), and the opening OVER probability is how often history beat it.
 * Returns null if there isn't enough history before the target.
 */
export function buildOverUnderRound(
  series: DailyAggregate[],
  targetDate: string,
  window = 30
): OverUnderRound | null {
  const idx = series.findIndex((d) => d.date === targetDate);
  if (idx < window) return null;

  const trailing = series.slice(idx - window, idx).map((d) => d.totalFine);
  const line = median(trailing);
  const overCount = trailing.filter((f) => f > line).length;
  // Clamp away from 0/1 so the LMSR seed stays finite and tradable.
  const baseRateOver = Math.min(0.95, Math.max(0.05, overCount / window));
  const actualFine = series[idx].totalFine;
  const outcomeIndex = actualFine > line ? 0 : 1;

  return { line, baseRateOver, actualFine, outcomeIndex, outcomes: [...OVER_UNDER_OUTCOMES] };
}

/** Days that have enough trailing history to be a round target. */
export function eligibleTargets(series: DailyAggregate[], window = 30): string[] {
  return series.slice(window).map((d) => d.date);
}
