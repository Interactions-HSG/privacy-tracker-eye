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
 * What kind of personal data a form field asks for. Derived in the content
 * script from the field's type/autocomplete/label — never from what is typed.
 */
export type DisclosureKind =
  | "name"
  | "email"
  | "phone"
  | "address"
  | "birthday"
  | "gender"
  | "password"
  | "payment"
  | "identifier" // SSN / passport / tax number …
  | "account-link" // "connect your X account"
  | "preferences" // hobbies, interests, opt-ins
  | "other";

/**
 * One act of disclosure, as recorded for the research log.
 *
 * PRIVACY INVARIANT: the typed *value* never leaves the page. Only the field's
 * kind, its visible label, and the number of characters are recorded.
 */
export interface DisclosureEvent {
  /** Wall-clock time (ms). */
  t: number;
  /** eTLD+1 of the page the field belongs to. */
  pageDomain: string;
  kind: DisclosureKind;
  /** Visible label of the field (site text, e.g. "E-mail address"). */
  label: string;
  /** Number of characters entered. Never the characters themselves. */
  chars: number;
  /** Sensitivity weight in [0,1] that drove the eye's inspection. */
  sensitivity: number;
}

/**
 * One field the participant filled in on this page. Identity of the field and
 * how much was typed — never what was typed.
 */
export interface DisclosedField {
  kind: DisclosureKind;
  /** Visible label of the field (site text). */
  label: string;
  /** Characters entered, as of the last report. */
  chars: number;
  /** Wall-clock time of the last report (ms). */
  t: number;
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
  /** Tracker requests per organisation — decides "who is watching" (skin). */
  organizationRequests: Record<string, number>;
  /** Total number of requests that matched the tracker list. */
  trackerRequestCount: number;
  /** Total number of third-party requests (tracker or not). */
  thirdPartyRequestCount: number;
  /** Distinct third-party domains that set a cookie via Set-Cookie. */
  thirdPartyCookieDomains: Record<string, true>;
  /** Aggregated fingerprinting evidence reported by the page probe (0..1). */
  fingerprinting: FingerprintEvidence;
  /** Fields filled in on this page, keyed by "kind:label". Never the values. */
  disclosures: Record<string, DisclosedField>;
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
  /** Organisation with the heaviest presence on this page, if any. */
  dominantOrganization: string | null;
  /** The heaviest few organisations, heaviest first — who the data miners work for. */
  topOrganizations: string[];
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

/**
 * Which palette the eye wears. "auto" makes the eye take on the colours of the
 * organisation that is actually watching the current page — the eye that reads
 * your e-mail address over your shoulder is visibly *Google's* eye.
 */
export type EyeSkin = "neutral" | "google" | "amazon" | "auto";

/** Per-installation configuration, persisted in `storage.local`. */
export interface Config {
  /** Master switch for the visual overlay (off = detection still runs/logs). */
  eyeEnabled: boolean;
  /** Which screen corner the eye sits in. */
  corner: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  /** Eye size in CSS pixels (width of the drawing surface). */
  size: number;
  /** Palette of the eye. */
  skin: EyeSkin;
  /**
   * Close inspection: when the participant starts filling in a form field on a
   * tracked page, the eye leaves its corner, flies to that field and reads
   * along. Off = the eye only ever floats in its corner (v0.1 behaviour).
   */
  inspection: boolean;
  /**
   * Data miners: while the participant types into a field on a tracked page,
   * small workers in the trackers' shirts run in, mine the field and carry the
   * chips out of the window. Independent of {@link Config.inspection}.
   */
  miners: boolean;
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
  skin: "neutral",
  inspection: true,
  miners: true,
  intensityOverride: null,
  logging: false,
};
