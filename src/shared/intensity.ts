// Tracking-intensity scoring (Deliverable 4).
//
// Pure functions, no browser APIs, so this module is trivially unit-testable
// and shared verbatim by the background (to compute) and the popup (to label).

import { SCORING } from "./scoring-config";
import type { FingerprintEvidence, IntensityResult, TabSignals } from "./types";

/** Saturating curve: 0 at x=0, ->1 as x->inf, ~0.63 at x=k. */
export function sat(x: number, k: number): number {
  if (x <= 0) return 0;
  return 1 - Math.exp(-x / k);
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Collapse the raw fingerprinting evidence counters into a single [0,1] score.
 * Breadth across techniques is rewarded: each technique saturates on its own,
 * then the saturated values are combined with weights.
 */
export function fingerprintingScore(fp: FingerprintEvidence): number {
  const { perTechniqueSaturation: k, techniqueWeights: w } = SCORING.fingerprinting;
  const s =
    w.canvas * sat(fp.canvas, k) +
    w.webgl * sat(fp.webgl, k) +
    w.audio * sat(fp.audio, k) +
    w.fonts * sat(fp.fonts, k) +
    w.enumeration * sat(fp.enumeration, k);
  return clamp01(s);
}

/**
 * The organisation with the heaviest presence on this page: tracker requests
 * weighted by how invasive the organisation's category is. Used to decide whose
 * colours the eye wears in "auto" skin mode, i.e. *who* is doing the watching.
 */
export function dominantOrganization(signals: TabSignals): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const [org, requests] of Object.entries(signals.organizationRequests)) {
    const category = signals.organizations[org] ?? "unknown";
    const score = requests * SCORING.categoryWeight[category];
    if (score > bestScore) {
      best = org;
      bestScore = score;
    }
  }
  return best;
}

/** Sum of per-organisation category weights => "effective organisation count". */
function weightedOrganizationCount(signals: TabSignals): number {
  let total = 0;
  for (const category of Object.values(signals.organizations)) {
    total += SCORING.categoryWeight[category];
  }
  return total;
}

/**
 * Convert accumulated {@link TabSignals} into a continuous intensity in [0,1]
 * plus the per-signal breakdown used by the popup and the event log.
 */
export function computeIntensity(signals: TabSignals): IntensityResult {
  const orgCount = weightedOrganizationCount(signals);
  const domainCount = Object.keys(signals.trackerDomains).length;
  const cookieCount = Object.keys(signals.thirdPartyCookieDomains).length;

  const components = {
    organizations: sat(orgCount, SCORING.saturation.organizations),
    domains: sat(domainCount, SCORING.saturation.domains),
    requests: sat(signals.trackerRequestCount, SCORING.saturation.requests),
    cookies: sat(cookieCount, SCORING.saturation.cookies),
    fingerprinting: fingerprintingScore(signals.fingerprinting),
  };

  const w = SCORING.weights;
  const weighted =
    w.organizations * components.organizations +
    w.domains * components.domains +
    w.requests * components.requests +
    w.cookies * components.cookies +
    w.fingerprinting * components.fingerprinting;

  const peak = Math.max(
    components.organizations,
    components.domains,
    components.requests,
    components.cookies,
    components.fingerprinting,
  );

  const intensity = clamp01((1 - SCORING.peakBlend) * weighted + SCORING.peakBlend * peak);

  return {
    intensity,
    band: bandFor(intensity),
    dominantOrganization: dominantOrganization(signals),
    components,
    counts: {
      organizations: Object.keys(signals.organizations).length,
      domains: domainCount,
      trackerRequests: signals.trackerRequestCount,
      thirdPartyRequests: signals.thirdPartyRequestCount,
      cookieDomains: cookieCount,
    },
  };
}

export function bandFor(intensity: number): IntensityResult["band"] {
  if (intensity < SCORING.bands.low) return "idle";
  if (intensity < SCORING.bands.medium) return "low";
  if (intensity < SCORING.bands.high) return "medium";
  return "high";
}
