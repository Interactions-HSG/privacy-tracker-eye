// Content-script entry point (top frame only; see manifest all_frames:false).
// -----------------------------------------------------------------------------
// Responsibilities:
//   1. Inject the page-world fingerprint probe and relay its findings to the
//      background.
//   2. Mount the Tracker Eye overlay and feed it the current cursor position.
//   3. Receive intensity-update messages and drive the eye (honouring the
//      research intensity override when set).
//   4. Watch the form fields the participant fills in, send the eye over to
//      read along, and report the *kind* of each disclosure to the background.
//   5. Send in the data miners, who carry what is typed out of the window.

import { SCORING } from "../shared/scoring-config";
import {
  PROBE_MESSAGE_TAG,
  type Message,
  type ProbeWindowMessage,
} from "../shared/messages";
import { EyeOverlay } from "./eye/overlay";
import { FieldWatcher } from "./field-watcher";
import { MinerCrew } from "./miners/miners";

const overlay = new EyeOverlay();
const miners = new MinerCrew();
// The eye's flight and the miners are separate study conditions on one watcher.
let flightOn = true;
let minersOn = false;

// --- 1. Inject the page-world fingerprint probe -----------------------------
// The Chrome build declares the probe in its manifest as a MAIN-world content
// script instead (it then also runs on pages whose CSP forbids injected
// scripts), so there is nothing to inject there.
function injectProbe(): void {
  if (__PROBE_IN_MANIFEST__) return;
  try {
    const script = document.createElement("script");
    script.src = browser.runtime.getURL("content/fingerprint-probe.js");
    script.async = false; // run in order, as early as possible
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  } catch {
    /* ignore — probe is best-effort */
  }
}

// Relay probe -> background.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as ProbeWindowMessage | undefined;
  if (!data || data.tag !== PROBE_MESSAGE_TAG) return;
  void browser.runtime
    .sendMessage({ type: "fingerprint-report", evidence: data.evidence } satisfies Message)
    .catch(() => {});
});

// --- 4. Close inspection of form fields -------------------------------------
const watcher = new FieldWatcher({
  onInspect: (target) => {
    overlay.inspect(flightOn ? target : null);
    miners.inspect(minersOn ? target : null);
  },
  onDisclosure: (kind, label, chars, sensitivity) => {
    // Kind, label and length only — the typed value stays in this page.
    void browser.runtime
      .sendMessage({ type: "disclosure-report", kind, label, chars, sensitivity } satisfies Message)
      .catch(() => {});
  },
});
watcher.install();

// --- 2 & 3. Eye overlay + intensity updates ---------------------------------
browser.runtime.onMessage.addListener((message: Message) => {
  if (message.type !== "intensity-update") return;
  const config = message.config;
  overlay.apply(config, message.result.dominantOrganization);

  const value =
    config.intensityOverride !== null ? config.intensityOverride : message.result.intensity;
  overlay.setIntensity(value);

  // The eye only leans in on pages where something is actually watching; on a
  // quiet page it stays relaxed in its corner even while a form is filled in.
  const tracked = config.eyeEnabled && value >= SCORING.bands.low;
  const wantFlight = config.inspection;
  const wantMiners = config.miners;
  if (wantFlight !== flightOn || wantMiners !== minersOn) {
    // A condition was switched mid-field: drop the current inspection so the
    // watcher re-announces the focused field under the new settings.
    flightOn = wantFlight;
    minersOn = wantMiners;
    watcher.setEnabled(false);
  }
  if (!minersOn || !config.eyeEnabled) miners.destroy();

  // The crew wears the shirts of whoever tracks this page. With a mock
  // intensity on an untracked page, a forced skin stands in as the employer.
  const employers = message.result.topOrganizations;
  const forced = config.skin === "google" ? "Google" : config.skin === "amazon" ? "Amazon" : null;
  miners.setOrganizations(employers.length > 0 ? employers : forced ? [forced] : []);

  watcher.setEnabled(tracked && (flightOn || minersOn));
});

// Feed cursor movement to the eye (throttled to animation cadence by the eye).
window.addEventListener(
  "mousemove",
  (e) => overlay.setCursor(e.clientX, e.clientY),
  { passive: true },
);

// Note: the eye animates via requestAnimationFrame, which the browser
// automatically suspends for background/hidden tabs, so no extra CPU work is
// done while a tab is not visible.

// --- Boot -------------------------------------------------------------------
injectProbe();
void browser.runtime.sendMessage({ type: "hello" } satisfies Message).catch(() => {});
