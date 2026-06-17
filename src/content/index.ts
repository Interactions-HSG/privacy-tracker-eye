// Content-script entry point (top frame only; see manifest all_frames:false).
// -----------------------------------------------------------------------------
// Responsibilities:
//   1. Inject the page-world fingerprint probe and relay its findings to the
//      background.
//   2. Mount the Tracker Eye overlay and feed it the current cursor position.
//   3. Receive intensity-update messages and drive the eye (honouring the
//      research intensity override when set).

import {
  PROBE_MESSAGE_TAG,
  type Message,
  type ProbeWindowMessage,
} from "../shared/messages";
import { EyeOverlay } from "./eye/overlay";

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

// --- 2 & 3. Eye overlay + intensity updates ---------------------------------
browser.runtime.onMessage.addListener((message: Message) => {
  if (message.type !== "intensity-update") return;
  overlay.apply(message.config);
  const value =
    message.config.intensityOverride !== null
      ? message.config.intensityOverride
      : message.result.intensity;
  overlay.setIntensity(value);
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
