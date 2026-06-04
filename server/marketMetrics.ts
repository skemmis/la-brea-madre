/**
 * Pure market-builders. Given a daily metric series (date → value), produce a
 * YES/NO market for a target day: the question's odds and its resolved outcome
 * are deterministic functions of the real history. No IO — unit-testable.
 *
 * Two shapes:
 *   • over/under — "Will <metric> exceed <line> today?" (line = trailing median)
 *   • face-off  — "Will <A> beat <B> today?" (e.g. Toyotas vs Hondas)
 *
 * YES is always outcome index 0, NO index 1.
 */
export interface MetricPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export const YES_NO = ["YES", "NO"] as const;

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// Clamp opening odds away from 0/1 so the LMSR seed stays finite and tradable.
const clampRate = (r: number) => Math.min(0.95, Math.max(0.05, r));

export interface OverUnderMarket {
  line: number; // the threshold (trailing median)
  baseRateYes: number; // opening P(value > line)
  actualValue: number; // the hidden truth for the target day
  outcomeIndex: number; // 0 = YES (over), 1 = NO
}

/**
 * Over/under on one metric for `targetDate`, using the trailing `window` days.
 * Line = median of the window (a genuine toss-up); odds = how often history
 * cleared it. Returns null without enough history before the target.
 */
export function buildOverUnderMarket(
  series: MetricPoint[],
  targetDate: string,
  window = 30
): OverUnderMarket | null {
  const idx = series.findIndex((d) => d.date === targetDate);
  if (idx < window) return null;

  const trailing = series.slice(idx - window, idx).map((d) => d.value);
  const line = median(trailing);
  const overCount = trailing.filter((v) => v > line).length;
  const actualValue = series[idx].value;

  return {
    line,
    baseRateYes: clampRate(overCount / window),
    actualValue,
    outcomeIndex: actualValue > line ? 0 : 1,
  };
}

export interface FaceoffMarket {
  baseRateYes: number; // opening P(A > B)
  actualA: number;
  actualB: number;
  outcomeIndex: number; // 0 = YES (A > B), 1 = NO
}

/**
 * Face-off between two metrics (A vs B) for `targetDate`: "will A beat B?".
 * Odds = how often A topped B over the trailing window. Series are aligned by
 * date; missing days count as 0. Returns null without enough shared history.
 */
export function buildFaceoffMarket(
  a: MetricPoint[],
  b: MetricPoint[],
  targetDate: string,
  window = 30
): FaceoffMarket | null {
  const bByDate = new Map(b.map((p) => [p.date, p.value]));
  const idx = a.findIndex((d) => d.date === targetDate);
  if (idx < window) return null;

  const trailing = a.slice(idx - window, idx);
  let aWins = 0;
  for (const p of trailing) {
    if (p.value > (bByDate.get(p.date) ?? 0)) aWins++;
  }
  const actualA = a[idx].value;
  const actualB = bByDate.get(targetDate) ?? 0;

  return {
    baseRateYes: clampRate(aWins / window),
    actualA,
    actualB,
    outcomeIndex: actualA > actualB ? 0 : 1,
  };
}

/** Days with enough trailing history to be a target. */
export function eligibleTargets(series: MetricPoint[], window = 30): string[] {
  return series.slice(window).map((d) => d.date);
}
