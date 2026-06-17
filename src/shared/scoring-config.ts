// Tunable parameters for the tracking-intensity model. Pulled out of the logic
// so a researcher can adjust the model for a study without touching code paths.
//
// The model is deliberately simple and transparent (see intensity.ts):
//   1. Each raw signal is passed through a saturating curve sat(x, k) so that
//      the first few trackers move the needle a lot and additional ones add
//      progressively less. k is the "half-ish saturation" constant per signal.
//   2. The saturated sub-scores are combined as a weighted average.
//   3. A small "peak" term lets a single extreme signal (e.g. an aggressive
//      canvas-fingerprinting attempt with otherwise few trackers) still raise
//      the score, matching the intuition that fingerprinting alone is alarming.

import type { TrackerCategory } from "./types";

export const SCORING = {
  /**
   * Saturation constants. sat(x, k) = 1 - exp(-x / k). At x == k the sub-score
   * is ~0.63; at x == 3k it is ~0.95. Smaller k => saturates faster.
   */
  saturation: {
    organizations: 3, // ~3 distinct tracker orgs already feels "watched"
    domains: 6,
    requests: 30,
    cookies: 4,
  },

  /**
   * Weights for the weighted average of the saturated sub-scores. They should
   * sum to 1. Organisations (cross-site reach) and fingerprinting (covert,
   * cookieless tracking) are weighted most heavily because they map most
   * directly onto privacy harm.
   */
  weights: {
    organizations: 0.3,
    domains: 0.15,
    requests: 0.15,
    cookies: 0.15,
    fingerprinting: 0.25,
  },

  /**
   * Blend between the weighted average and the single strongest sub-score.
   * peak = 0.15 means the final score is 85% weighted-average + 15% max-signal.
   */
  peakBlend: 0.15,

  /**
   * Each tracker organisation is counted with a weight reflecting how invasive
   * its category is. The effective "organisation count" fed into the saturation
   * curve is the sum of these weights, not a plain tally, so three advertising
   * trackers count for more than three essential tag managers.
   */
  categoryWeight: {
    advertising: 1.0,
    fingerprinting: 1.0,
    cryptomining: 1.0,
    analytics: 0.8,
    social: 0.8,
    content: 0.5,
    essential: 0.35,
    unknown: 0.6,
  } satisfies Record<TrackerCategory, number>,

  /**
   * Fingerprinting evidence -> [0,1]. Each technique saturates on its own count
   * and the techniques are combined so that breadth (many techniques) matters
   * more than depth (one technique many times).
   */
  fingerprinting: {
    perTechniqueSaturation: 2, // 2 read-backs of one API ~ 0.63 for that API
    // How much each technique can contribute (sums to 1).
    techniqueWeights: {
      canvas: 0.3,
      webgl: 0.2,
      audio: 0.2,
      fonts: 0.15,
      enumeration: 0.15,
    },
  },

  /** Band thresholds on the final continuous intensity. */
  bands: {
    low: 0.08, // below this the eye is "idle" (relaxed, may drift off-screen)
    medium: 0.4,
    high: 0.7,
  },
} as const;
