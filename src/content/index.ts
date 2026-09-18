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

import { SCORING } from "../shared/scoring-config";
import {
  PROBE_MESSAGE_TAG,
  type Message,
  type ProbeWindowMessage,
} from "../shared/messages";
import { EyeOverlay } from "./eye/overlay";
import { FieldWatcher } from "./field-watcher";

const overlay = new EyeOverlay();

// --- 1. Inject the page-world fingerprint probe -----------------------------
function injectProbe(): void {
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
  onInspect: (target) => overlay.inspect(target),
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
  watcher.setEnabled(config.eyeEnabled && config.inspection && value >= SCORING.bands.low);
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
