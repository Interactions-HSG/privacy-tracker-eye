// Network observation via the WebRequest API (Deliverable 3, detection core).
// -----------------------------------------------------------------------------
// We attach NON-BLOCKING listeners. Tracker Eye never blocks or modifies a
// request — it only watches, so installing it does not change the pages a
// participant sees during a study (important for clean experimental control).
//
//   onBeforeRequest   : reset state on top-level navigation; classify each
//                       sub-request and record tracker hits.
//   onHeadersReceived : detect third-party domains that attempt Set-Cookie.

import { classify, registrableDomain } from "./tracker-engine";
import type { TabStateStore } from "./tab-state";

export interface ObserverHooks {
  /** Called when a tab begins loading a new top-level document. */
  onNavigate: (tabId: number, pageDomain: string) => void;
  /** Called (frequently) whenever a tab's signals changed. */
  onSignals: (tabId: number) => void;
}

const URL_FILTER: browser.webRequest.RequestFilter = { urls: ["<all_urls>"] };

export function installRequestObserver(store: TabStateStore, hooks: ObserverHooks): void {
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0) return; // not tied to a tab (e.g. service worker)
      if (!/^https?:/.test(details.url)) return;

      // A new top-level document => reset this tab's accumulated signals.
      if (details.type === "main_frame") {
        const pageDomain = registrableDomain(details.url) ?? "";
        store.reset(details.tabId, pageDomain);
        hooks.onNavigate(details.tabId, pageDomain);
        return;
      }

      const signals = store.get(details.tabId);
      if (!signals) return; // page domain not established yet; ignore safely.

      const c = classify(details.url, signals.pageDomain);
      if (!c.thirdParty) return;

      store.recordRequest(details.tabId, true, c.tracker);
      hooks.onSignals(details.tabId);
    },
    URL_FILTER,
    [], // non-blocking
  );

  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (details.tabId < 0) return;
      if (!/^https?:/.test(details.url)) return;
      const signals = store.get(details.tabId);
      if (!signals) return;

      const headers = details.responseHeaders;
      if (!headers) return;
      const setsCookie = headers.some((h) => h.name.toLowerCase() === "set-cookie");
      if (!setsCookie) return;

      const c = classify(details.url, signals.pageDomain);
      if (!c.thirdParty || !c.requestDomain) return;

      // A third party attempting to set a cookie is a tracking signal even if
      // the browser ultimately partitions or blocks it.
      store.recordThirdPartyCookie(details.tabId, c.requestDomain);
      hooks.onSignals(details.tabId);
    },
    URL_FILTER,
    ["responseHeaders"],
  );
}
