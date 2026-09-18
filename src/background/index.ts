// Background entry point — orchestration only.
// -----------------------------------------------------------------------------
// Owns: configuration, the per-tab state store, the WebRequest observer, the
// throttled push of intensity to content scripts, the messaging surface used by
// the popup, and an optional in-memory event log for user studies.

import { computeIntensity } from "../shared/intensity";
import type { Message } from "../shared/messages";
import {
  DEFAULT_CONFIG,
  type Config,
  type DisclosureEvent,
  type IntensityResult,
} from "../shared/types";
import { installRequestObserver } from "./request-observer";
import { TabStateStore } from "./tab-state";
import { registrableDomain } from "./tracker-engine";

const store = new TabStateStore();
let config: Config = { ...DEFAULT_CONFIG };

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
async function loadConfig(): Promise<void> {
  const stored = await browser.storage.local.get("config");
  config = { ...DEFAULT_CONFIG, ...(stored.config as Partial<Config> | undefined) };
}

async function saveConfig(patch: Partial<Config>): Promise<void> {
  config = { ...config, ...patch };
  await browser.storage.local.set({ config });
  // Re-push so changes (eye on/off, size, corner, override) take effect live.
  pushToAllTabs();
}

// ---------------------------------------------------------------------------
// Intensity push (throttled)
// ---------------------------------------------------------------------------
const dirtyTabs = new Set<number>();

function intensityFor(tabId: number): IntensityResult | null {
  const signals = store.get(tabId);
  return signals ? computeIntensity(signals) : null;
}

async function pushToTab(tabId: number): Promise<void> {
  const result = intensityFor(tabId);
  if (!result) return;
  try {
    await browser.tabs.sendMessage(tabId, { type: "intensity-update", result, config });
  } catch {
    // No content script on this tab (about:, view-source:, PDF, …) — ignore.
  }
}

function pushToAllTabs(): void {
  for (const tabId of new Set([...dirtyTabs, ...activeTabIds()])) void pushToTab(tabId);
}

const knownTabs = new Set<number>();
function activeTabIds(): number[] {
  return [...knownTabs];
}

// Coalesce bursts of requests into at most one push per tab per interval.
setInterval(() => {
  if (dirtyTabs.size === 0) return;
  const batch = [...dirtyTabs];
  dirtyTabs.clear();
  for (const tabId of batch) void pushToTab(tabId);
}, 350);

// ---------------------------------------------------------------------------
// Research event log (optional)
// ---------------------------------------------------------------------------
interface LogSample {
  t: number;
  tabId: number;
  pageDomain: string;
  intensity: number;
  band: IntensityResult["band"];
  counts: IntensityResult["counts"];
}
const log: LogSample[] = [];
const LOG_CAP = 10_000;

/**
 * Every disclosure the participant made, in order. This is the ground truth a
 * study needs when it asks "which data did you just hand over?" — and it holds
 * kinds, labels and lengths only, never a typed value.
 */
const disclosureLog: DisclosureEvent[] = [];
const DISCLOSURE_CAP = 5_000;

setInterval(async () => {
  if (!config.logging) return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return;
  const signals = store.get(tab.id);
  if (!signals) return;
  const result = computeIntensity(signals);
  log.push({
    t: Date.now(),
    tabId: tab.id,
    pageDomain: signals.pageDomain,
    intensity: Number(result.intensity.toFixed(4)),
    band: result.band,
    counts: result.counts,
  });
  if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
}, 1000);

// ---------------------------------------------------------------------------
// Observer wiring
// ---------------------------------------------------------------------------
installRequestObserver(store, {
  onNavigate: (tabId) => {
    knownTabs.add(tabId);
    void pushToTab(tabId); // immediate reset to idle on new page
  },
  onSignals: (tabId) => {
    knownTabs.add(tabId);
    dirtyTabs.add(tabId);
  },
});

// ---------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------
browser.tabs.onRemoved.addListener((tabId) => {
  store.remove(tabId);
  knownTabs.delete(tabId);
  dirtyTabs.delete(tabId);
});

// Initialise already-open tabs so the extension works without a reload.
async function primeOpenTabs(): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) continue;
    store.reset(tab.id, registrableDomain(tab.url) ?? "");
    knownTabs.add(tab.id);
  }
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------
browser.runtime.onMessage.addListener((message: Message, sender) => {
  switch (message.type) {
    case "hello": {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        knownTabs.add(tabId);
        void pushToTab(tabId);
      }
      return false;
    }
    case "fingerprint-report": {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        store.addFingerprint(tabId, message.evidence);
        dirtyTabs.add(tabId);
      }
      return false;
    }
    case "disclosure-report": {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        const signals = store.recordDisclosure(tabId, message.kind, message.label, message.chars);
        disclosureLog.push({
          t: Date.now(),
          pageDomain: signals?.pageDomain ?? "",
          kind: message.kind,
          label: message.label,
          chars: message.chars,
          sensitivity: message.sensitivity,
        });
        if (disclosureLog.length > DISCLOSURE_CAP) {
          disclosureLog.splice(0, disclosureLog.length - DISCLOSURE_CAP);
        }
        dirtyTabs.add(tabId);
      }
      return false;
    }
    case "get-snapshot": {
      return (async () => {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tab?.id;
        const signals = tabId !== undefined ? (store.get(tabId) ?? null) : null;
        const result = signals ? computeIntensity(signals) : null;
        return { type: "snapshot", signals, result, config } as Message;
      })();
    }
    case "set-config": {
      return saveConfig(message.config).then(() => ({ type: "snapshot", signals: null, result: null, config }) as Message);
    }
    case "export-log": {
      const json = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          samples: log,
          disclosures: disclosureLog,
        },
        null,
        2,
      );
      return Promise.resolve({ type: "export-log-result", json } as Message);
    }
    default:
      return false;
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
void (async () => {
  await loadConfig();
  await primeOpenTabs();
})();
