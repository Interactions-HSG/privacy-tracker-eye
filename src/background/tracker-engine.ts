// Tracker classification engine.
// -----------------------------------------------------------------------------
// Wraps the bundled tracker list (src/data/trackers.ts) and the `tldts` library
// (MIT — the same registrable-domain parser used by @ghostery/adblocker). Given
// a request URL and the URL of the top-level page, it decides:
//   (a) is the request third-party (different registrable domain)?
//   (b) does it match a known tracker, and if so which org/category?
//
// SWAPPING IN @ghostery/adblocker:
//   Replace `classify()`'s body with a call to a pre-built engine, e.g.
//     const m = engine.match(Request.fromRawDetails({ url, sourceUrl, type }));
//   and map m.metadata -> TrackerHit. The rest of the extension is unchanged
//   because it only consumes the `Classification` shape below.

import { getDomain } from "tldts";
import { lookupTracker } from "../data/trackers";
import type { TrackerHit } from "../shared/types";

export interface Classification {
  /** Registrable domain (eTLD+1) of the request, or null if unparineable. */
  requestDomain: string | null;
  /** True when the request goes to a different registrable domain than page. */
  thirdParty: boolean;
  /** Present when the request matched the tracker list. */
  tracker?: TrackerHit;
}

/** Cheap memoisation: registrable-domain extraction is the hot path. */
const domainCache = new Map<string, string | null>();

function registrableDomain(url: string): string | null {
  const cached = domainCache.get(url);
  if (cached !== undefined) return cached;
  let domain: string | null = null;
  try {
    domain = getDomain(url);
  } catch {
    domain = null;
  }
  // Bound the cache so long-lived sessions don't grow it without limit.
  if (domainCache.size > 5000) domainCache.clear();
  domainCache.set(url, domain);
  return domain;
}

/**
 * Classify a single request relative to the page that issued it.
 * @param requestUrl  the URL being fetched
 * @param pageDomain  the registrable domain of the top-level page (precomputed)
 */
export function classify(requestUrl: string, pageDomain: string | null): Classification {
  const requestDomain = registrableDomain(requestUrl);
  const thirdParty = requestDomain !== null && pageDomain !== null && requestDomain !== pageDomain;
  if (!thirdParty) {
    return { requestDomain, thirdParty: false };
  }
  const tracker = lookupTracker(requestDomain);
  return { requestDomain, thirdParty: true, tracker };
}

export { registrableDomain };
