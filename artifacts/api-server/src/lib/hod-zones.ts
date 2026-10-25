// Performance zones, in one place so the thresholds can be changed later
// without hunting through the routes. A zone is a band of a learner's average
// across their RELEASED, MARKED results only — a held result never counts.
//
//   green  : 60% or above
//   yellow : 40% to 59%
//   red    : below 40%
//
// A learner with fewer than MIN_RESULTS_FOR_ZONE marked results has too little
// evidence to place, so they are counted as "not enough data" and are NEVER red.
export const ZONE_CONFIG = {
  greenMin: 60,
  yellowMin: 40,
  minResultsForZone: 3,
} as const;

export type Zone = "green" | "yellow" | "red" | "insufficient";
export type ZoneCounts = { green: number; yellow: number; red: number; insufficient: number; total: number };

export function zoneFor(averageScore: number, resultCount: number): Zone {
  if (resultCount < ZONE_CONFIG.minResultsForZone) return "insufficient";
  if (averageScore >= ZONE_CONFIG.greenMin) return "green";
  if (averageScore >= ZONE_CONFIG.yellowMin) return "yellow";
  return "red";
}

// Zone output is counts only: the HOD sees how many learners sit in each band,
// never which learner sits where.
export function countZones(entries: Array<{ averageScore: number; resultCount: number }>): ZoneCounts {
  const counts: ZoneCounts = { green: 0, yellow: 0, red: 0, insufficient: 0, total: entries.length };
  for (const entry of entries) counts[zoneFor(entry.averageScore, entry.resultCount)] += 1;
  return counts;
}
