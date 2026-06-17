// Per-tab signal accumulation.
// -----------------------------------------------------------------------------
// Holds one TabSignals record per open tab and resets it whenever the tab
// navigates to a new top-level document, so the intensity always reflects the
// page the user is currently looking at.

import type { FingerprintEvidence, TabSignals, TrackerHit } from "../shared/types";

function emptyFingerprint(): FingerprintEvidence {
  return { canvas: 0, webgl: 0, audio: 0, fonts: 0, enumeration: 0 };
}

function freshSignals(tabId: number, pageDomain: string): TabSignals {
  return {
    tabId,
    pageDomain,
    trackerDomains: {},
    organizations: {},
    trackerRequestCount: 0,
    thirdPartyRequestCount: 0,
    thirdPartyCookieDomains: {},
    fingerprinting: emptyFingerprint(),
    lastUpdate: Date.now(),
  };
}

export class TabStateStore {
  private readonly tabs = new Map<number, TabSignals>();

  get(tabId: number): TabSignals | undefined {
    return this.tabs.get(tabId);
  }

  /** Reset (or create) the signals for a tab on a new top-level navigation. */
  reset(tabId: number, pageDomain: string): TabSignals {
    const signals = freshSignals(tabId, pageDomain);
    this.tabs.set(tabId, signals);
    return signals;
  }

  remove(tabId: number): void {
    this.tabs.delete(tabId);
  }

  /** Record a third-party request and, if applicable, a tracker match. */
  recordRequest(tabId: number, thirdParty: boolean, tracker?: TrackerHit): TabSignals | undefined {
    const signals = this.tabs.get(tabId);
    if (!signals) return undefined;
    if (thirdParty) signals.thirdPartyRequestCount += 1;
    if (tracker) {
      signals.trackerRequestCount += 1;
      signals.trackerDomains[tracker.domain] = tracker;
      // Keep the strongest-known category if an org appears under several.
      signals.organizations[tracker.organization] = tracker.category;
    }
    signals.lastUpdate = Date.now();
    return signals;
  }

  /** Record that a third-party domain set a cookie via Set-Cookie. */
  recordThirdPartyCookie(tabId: number, domain: string): TabSignals | undefined {
    const signals = this.tabs.get(tabId);
    if (!signals) return undefined;
    signals.thirdPartyCookieDomains[domain] = true;
    signals.lastUpdate = Date.now();
    return signals;
  }

  /** Merge a fingerprinting-evidence delta reported by a page probe. */
  addFingerprint(tabId: number, delta: Partial<FingerprintEvidence>): TabSignals | undefined {
    const signals = this.tabs.get(tabId);
    if (!signals) return undefined;
    const fp = signals.fingerprinting;
    fp.canvas += delta.canvas ?? 0;
    fp.webgl += delta.webgl ?? 0;
    fp.audio += delta.audio ?? 0;
    fp.fonts += delta.fonts ?? 0;
    fp.enumeration += delta.enumeration ?? 0;
    signals.lastUpdate = Date.now();
    return signals;
  }
}
