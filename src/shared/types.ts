// Shared data model used across the background, content, and popup contexts.
// Everything here is plain data so it can be sent over `runtime.sendMessage`.

/**
 * Coarse classification of a tracker, borrowed from the categories used by the
 * Disconnect / Ghostery open-source tracker lists. The category drives how
 * heavily a given tracker contributes to the intensity score: cross-site
 * advertising and fingerprinting are weighted more than, say, a CDN.
 */
export type TrackerCategory =
  | "advertising"
  | "analytics"
  | "social"
  | "fingerprinting"
  | "cryptomining"
  | "content" // content/CDN that is also known to track
  | "essential" // tag managers, consent tools — present but lower harm
  | "unknown";

/** A third-party organisation that owns one or more tracker domains. */
export interface TrackerHit {
  /** eTLD+1 of the request, e.g. "google-analytics.com". */
  domain: string;
  /** Owning organisation, e.g. "Google". Falls back to the domain. */
  organization: string;
  category: TrackerCategory;
}

/**
 * Everything we have observed for a single top-level page load. Reset whenever
 * the tab navigates to a new top-level document.
 */
export interface TabSignals {
  tabId: number;
  /** eTLD+1 of the top-level page, e.g. "nytimes.com". */
  pageDomain: string;
  /** Distinct tracker domains seen, keyed by domain. */
  trackerDomains: Record<string, TrackerHit>;
  /** Distinct tracker organisations seen. */
  organizations: Record<string, TrackerCategory>;
  /** Total number of requests that matched the tracker list. */
  trackerRequestCount: number;
  /** Total number of third-party requests (tracker or not). */
  thirdPartyRequestCount: number;
  /** Distinct third-party domains that set a cookie via Set-Cookie. */
  thirdPartyCookieDomains: Record<string, true>;
  /** Aggregated fingerprinting evidence reported by the page probe (0..1). */
  fingerprinting: FingerprintEvidence;
  /** Wall-clock time of the last update (ms). */
  lastUpdate: number;
}

/** Fingerprinting evidence collected by the in-page probe. */
export interface FingerprintEvidence {
  canvas: number; // canvas read-back calls (toDataURL / getImageData)
  webgl: number; // WebGL parameter / renderer probing
  audio: number; // AudioContext fingerprinting
  fonts: number; // font enumeration / measureText sweeps
  enumeration: number; // navigator / screen / plugin enumeration bursts
}

/** The continuous tracking-intensity result derived from {@link TabSignals}. */
export interface IntensityResult {
  /** Continuous score in [0, 1] that drives the eye's behaviour. */
  intensity: number;
  /** Discrete band for convenience (UI labels, logging). */
  band: "idle" | "low" | "medium" | "high";
  /** Per-signal sub-scores in [0, 1], for transparency / the popup / logs. */
  components: {
    organizations: number;
    domains: number;
    requests: number;
    cookies: number;
    fingerprinting: number;
  };
  /** Raw counts, surfaced for the research popup and event log. */
  counts: {
    organizations: number;
    domains: number;
    trackerRequests: number;
    thirdPartyRequests: number;
    cookieDomains: number;
  };
}

/** Per-installation configuration, persisted in `storage.local`. */
export interface Config {
  /** Master switch for the visual overlay (off = detection still runs/logs). */
  eyeEnabled: boolean;
  /** Which screen corner the eye sits in. */
  corner: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  /** Eye size in CSS pixels (width of the drawing surface). */
  size: number;
  /**
   * Research override. When non-null, the eye ignores measured intensity and
   * uses this fixed value in [0, 1] — used to script experimental conditions.
   */
  intensityOverride: number | null;
  /** When true, append an intensity sample per second to the in-memory log. */
  logging: boolean;
}

export const DEFAULT_CONFIG: Config = {
  eyeEnabled: true,
  corner: "top-right",
  size: 320,
  intensityOverride: null,
  logging: false,
};
