// Bundled tracker intelligence.
// =============================================================================
// Each entry maps an eTLD+1 to its owning organisation and a category. The data
// reproduces the structure and categories of the open-source Disconnect list
// (https://github.com/disconnectme/disconnect-tracking-protection, GPL-3.0 for
// code / CC-BY-NC-SA for the list) and the Ghostery TrackerDB
// (https://github.com/ghostery/trackerdb, MPL-2.0). It is a curated SUBSET that
// covers the trackers present on essentially every major site, so the prototype
// produces strong, deterministic signals out of the box with no network fetch.
//
// REGENERATING / REPLACING THIS LIST (documented in README "Detection core"):
//   The matcher behind `lookupTracker()` only needs `Record<eTLD+1, TrackerHit>`.
//   To use the full upstream data instead of this subset, run
//   `npm run import:trackers` (scripts/import-trackers.mjs), which downloads the
//   open-source Disconnect services.json and emits src/data/trackers.generated.ts
//   with the same API — then point the two imports of "../data/trackers" at
//   "../data/trackers.generated". Alternatively drop in `@ghostery/adblocker`
//   and forward its `engine.match()` results into the same `TrackerHit` shape.
// =============================================================================

import type { TrackerCategory, TrackerHit } from "../shared/types";

type Row = [organization: string, category: TrackerCategory];

// Keyed by eTLD+1. Kept compact; grouped by organisation for readability.
const RAW: Record<string, Row> = {
  // --- Google / Alphabet -----------------------------------------------------
  "doubleclick.net": ["Google", "advertising"],
  "googlesyndication.com": ["Google", "advertising"],
  "googleadservices.com": ["Google", "advertising"],
  "2mdn.net": ["Google", "advertising"],
  "google-analytics.com": ["Google", "analytics"],
  "app-measurement.com": ["Google", "analytics"],
  "googletagmanager.com": ["Google", "essential"],
  "googletagservices.com": ["Google", "advertising"],
  "gstatic.com": ["Google", "content"],
  "googleapis.com": ["Google", "content"],

  // --- Meta / Facebook -------------------------------------------------------
  "facebook.com": ["Meta", "social"],
  "facebook.net": ["Meta", "social"],
  "fbcdn.net": ["Meta", "content"],
  "atdmt.com": ["Meta", "advertising"],
  "instagram.com": ["Meta", "social"],

  // --- Amazon ----------------------------------------------------------------
  "amazon-adsystem.com": ["Amazon", "advertising"],
  "assoc-amazon.com": ["Amazon", "advertising"],
  "serving-sys.com": ["Amazon", "advertising"],

  // --- Microsoft -------------------------------------------------------------
  "bing.com": ["Microsoft", "advertising"],
  "clarity.ms": ["Microsoft", "analytics"],
  "linkedin.com": ["Microsoft", "social"],
  "licdn.com": ["Microsoft", "content"],

  // --- Adobe -----------------------------------------------------------------
  "omtrdc.net": ["Adobe", "analytics"],
  "2o7.net": ["Adobe", "analytics"],
  "demdex.net": ["Adobe", "advertising"],
  "everesttech.net": ["Adobe", "advertising"],
  "adobedtm.com": ["Adobe", "essential"],
  "typekit.net": ["Adobe", "content"],
  "scene7.com": ["Adobe", "content"],

  // --- Oracle ----------------------------------------------------------------
  "bluekai.com": ["Oracle", "advertising"],
  "bkrtx.com": ["Oracle", "advertising"],
  "addthis.com": ["Oracle", "social"],
  "moatads.com": ["Oracle", "advertising"],
  "nexac.com": ["Oracle", "advertising"],
  "en25.com": ["Oracle", "analytics"],

  // --- Independent ad exchanges / DSPs / SSPs --------------------------------
  "criteo.com": ["Criteo", "advertising"],
  "criteo.net": ["Criteo", "advertising"],
  "adsrvr.org": ["The Trade Desk", "advertising"],
  "pubmatic.com": ["PubMatic", "advertising"],
  "casalemedia.com": ["Index Exchange", "advertising"],
  "openx.net": ["OpenX", "advertising"],
  "rubiconproject.com": ["Magnite", "advertising"],
  "adnxs.com": ["Xandr", "advertising"],
  "adform.net": ["Adform", "advertising"],
  "adroll.com": ["AdRoll", "advertising"],
  "mathtag.com": ["MediaMath", "advertising"],
  "bidswitch.net": ["BidSwitch", "advertising"],
  "smartadserver.com": ["Smart", "advertising"],
  "3lift.com": ["TripleLift", "advertising"],
  "sharethrough.com": ["Sharethrough", "advertising"],
  "teads.tv": ["Teads", "advertising"],
  "contextweb.com": ["PulsePoint", "advertising"],
  "gumgum.com": ["GumGum", "advertising"],
  "advertising.com": ["Yahoo", "advertising"],
  "flashtalking.com": ["Flashtalking", "advertising"],
  "rlcdn.com": ["LiveRamp", "advertising"],
  "id5-sync.com": ["ID5", "advertising"],
  "crwdcntrl.net": ["Lotame", "advertising"],
  "agkn.com": ["Neustar", "advertising"],
  "tapad.com": ["Tapad", "advertising"],
  "eyeota.net": ["Eyeota", "advertising"],
  "zemanta.com": ["Zemanta", "advertising"],
  "taboola.com": ["Taboola", "advertising"],
  "outbrain.com": ["Outbrain", "advertising"],

  // --- Audience measurement / analytics --------------------------------------
  "quantserve.com": ["Quantcast", "advertising"],
  "quantcount.com": ["Quantcast", "analytics"],
  "scorecardresearch.com": ["Comscore", "analytics"],
  "comscore.com": ["Comscore", "analytics"],
  "imrworldwide.com": ["Nielsen", "analytics"],
  "chartbeat.com": ["Chartbeat", "analytics"],
  "chartbeat.net": ["Chartbeat", "analytics"],
  "parsely.com": ["Parse.ly", "analytics"],
  "newrelic.com": ["New Relic", "analytics"],
  "nr-data.net": ["New Relic", "analytics"],
  "cloudflareinsights.com": ["Cloudflare", "analytics"],

  // --- Product analytics / session replay ------------------------------------
  "hotjar.com": ["Hotjar", "analytics"],
  "hotjar.io": ["Hotjar", "analytics"],
  "fullstory.com": ["FullStory", "analytics"],
  "mouseflow.com": ["Mouseflow", "analytics"],
  "inspectlet.com": ["Inspectlet", "analytics"],
  "luckyorange.com": ["Lucky Orange", "analytics"],
  "crazyegg.com": ["Crazy Egg", "analytics"],
  "segment.com": ["Segment", "analytics"],
  "segment.io": ["Segment", "analytics"],
  "amplitude.com": ["Amplitude", "analytics"],
  "mixpanel.com": ["Mixpanel", "analytics"],
  "heapanalytics.com": ["Heap", "analytics"],
  "optimizely.com": ["Optimizely", "analytics"],
  "branch.io": ["Branch", "analytics"],
  "adjust.com": ["Adjust", "analytics"],
  "appsflyer.com": ["AppsFlyer", "analytics"],
  "intercom.io": ["Intercom", "analytics"],
  "intercomcdn.com": ["Intercom", "content"],
  "drift.com": ["Drift", "analytics"],
  "zopim.com": ["Zendesk", "analytics"],
  "zdassets.com": ["Zendesk", "content"],

  // --- Social widgets --------------------------------------------------------
  "twitter.com": ["X", "social"],
  "t.co": ["X", "social"],
  "ads-twitter.com": ["X", "advertising"],
  "twimg.com": ["X", "content"],
  "pinterest.com": ["Pinterest", "social"],
  "pinimg.com": ["Pinterest", "content"],
  "tiktok.com": ["TikTok", "social"],
  "snapchat.com": ["Snap", "social"],
  "sc-static.net": ["Snap", "content"],
  "reddit.com": ["Reddit", "social"],
  "redditstatic.com": ["Reddit", "content"],
  "disqus.com": ["Disqus", "social"],
  "disquscdn.com": ["Disqus", "content"],
  "vk.com": ["VK", "social"],
  "yandex.ru": ["Yandex", "analytics"],
  "yandex.net": ["Yandex", "content"],

  // --- Dedicated device-fingerprinting / anti-fraud vendors ------------------
  "fingerprint.com": ["FingerprintJS", "fingerprinting"],
  "fpjs.io": ["FingerprintJS", "fingerprinting"],
  "online-metrix.net": ["ThreatMetrix", "fingerprinting"],
  "iesnare.com": ["iovation", "fingerprinting"],
  "perimeterx.net": ["PerimeterX", "fingerprinting"],
  "siftscience.com": ["Sift", "fingerprinting"],
  "stripe.network": ["Stripe", "fingerprinting"],

  // --- Cryptomining ----------------------------------------------------------
  "coinhive.com": ["Coinhive", "cryptomining"],
  "coin-hive.com": ["Coinhive", "cryptomining"],
  "crypto-loot.com": ["Crypto-Loot", "cryptomining"],
  "jsecoin.com": ["JSECoin", "cryptomining"],
  "webmine.cz": ["WebMine", "cryptomining"],

  // --- Consent / tag management (present, lower harm) ------------------------
  "cookielaw.org": ["OneTrust", "essential"],
  "onetrust.com": ["OneTrust", "essential"],
  "cookiebot.com": ["Cookiebot", "essential"],
  "consensu.org": ["IAB TCF", "essential"],
  "usercentrics.eu": ["Usercentrics", "essential"],
  "trustarc.com": ["TrustArc", "essential"],
  "ensighten.com": ["Ensighten", "essential"],
  "tealiumiq.com": ["Tealium", "essential"],
  "tiqcdn.com": ["Tealium", "content"],
};

/** Frozen lookup table: eTLD+1 -> {domain, organization, category}. */
const TRACKERS: Map<string, TrackerHit> = new Map(
  Object.entries(RAW).map(([domain, [organization, category]]) => [
    domain,
    { domain, organization, category },
  ]),
);

/** Total number of bundled tracker domains (shown in the popup for context). */
export const TRACKER_COUNT = TRACKERS.size;

/**
 * Look up a tracker by the eTLD+1 of a request. Returns undefined if the domain
 * is not a known tracker. O(1).
 */
export function lookupTracker(registrableDomain: string | null): TrackerHit | undefined {
  if (!registrableDomain) return undefined;
  return TRACKERS.get(registrableDomain);
}
