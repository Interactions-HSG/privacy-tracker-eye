// Mock tracking for the Tracker Eye study fixture.
// =============================================================================
// This file makes the fixture behave like an ordinary commercial site: it
// beacons page views, field focus, typing activity and form submissions to
// third-party tracker domains, and it fingerprints the browser on load. Tracker
// Eye observes those requests exactly as it observes the real thing, so the eye
// reacts on this site the way it reacts on a real shop.
//
// WHAT IS SENT (and what is not)
//   Sent:     the page name, the event, the *name of the field* (e.g. "email"),
//             and how many characters it currently holds.
//   Not sent: anything a participant types. No values, ever. Reading the code
//             below is the check — there is no path from `.value` to a URL.
//
//   The beacons go to the REAL tracker hostnames (google-analytics.com, …)
//   because Tracker Eye classifies by domain, so a local stand-in would not be
//   recognised. The requests fail (no such endpoint exists) — that is fine and
//   expected: the extension only needs to *observe* the attempt. To keep them
//   on the machine entirely, point those hostnames at 127.0.0.1 in /etc/hosts;
//   the requests are still observed, and never leave the lab.
//
// Choose who does the tracking per page with a data attribute:
//   <script src="assets/mock-tracking.js" data-profile="google"></script>
// The profile decides which organisation dominates, which is what the eye's
// "auto" skin picks up on.
// =============================================================================

(() => {
  "use strict";

  const PROFILES = {
    // Alphabet-heavy: analytics + tag manager + ad exchange.
    google: [
      "google-analytics.com",
      "googletagmanager.com",
      "doubleclick.net",
      "googlesyndication.com",
      "app-measurement.com",
      "googleadservices.com",
    ],
    // Retail/ad-tech-heavy.
    amazon: [
      "amazon-adsystem.com",
      "assoc-amazon.com",
      "serving-sys.com",
      "adsrvr.org",
      "criteo.com",
    ],
    // The usual crowd on a mainstream commercial page.
    mixed: [
      "google-analytics.com",
      "doubleclick.net",
      "facebook.net",
      "amazon-adsystem.com",
      "criteo.com",
      "hotjar.com",
      "scorecardresearch.com",
      "taboola.com",
      "clarity.ms",
      "adnxs.com",
    ],
  };

  const script = document.currentScript;
  const profile = (script && script.dataset.profile) || "mixed";
  const HOSTS = PROFILES[profile] || PROFILES.mixed;
  const PAGE = location.pathname.split("/").pop() || "index.html";

  let rotation = 0;

  /** Fire a tracking pixel at `hosts`. Field names and counts only. */
  function beacon(event, params, hosts) {
    const query = new URLSearchParams(
      Object.assign({ ev: event, p: PAGE, t: String(Date.now()) }, params || {}),
    );
    for (const host of hosts || HOSTS) {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onerror = img.onload = null;
      img.src = "https://" + host + "/te-study.gif?" + query.toString();
    }
  }

  /** Two rotating partners per interaction, the way real tag soup behaves. */
  function partial() {
    const a = HOSTS[rotation++ % HOSTS.length];
    const b = HOSTS[rotation++ % HOSTS.length];
    return a === b ? [a] : [a, b];
  }

  /** The stable identifier of a field for the beacon: its name, never a value. */
  function fieldName(el) {
    return el.name || el.id || (el.getAttribute && el.getAttribute("aria-label")) || el.type || "field";
  }

  // --- browser fingerprinting, as a real ad stack does on load ---------------
  function fingerprint() {
    try {
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillText("nimbus-market-fp \u{1F600}", 2, 2);
      for (const f of ["Arial", "Courier", "Times", "Verdana", "Georgia", "Tahoma"]) {
        ctx.font = "12px " + f;
        ctx.measureText("mmmmmmmmmmlli");
      }
      c.toDataURL();
    } catch (e) { /* ignore */ }

    try {
      const gl = document.createElement("canvas").getContext("webgl");
      if (gl) {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        gl.getParameter(gl.VENDOR);
      }
    } catch (e) { /* ignore */ }

    try {
      const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (Ctx) {
        const ac = new Ctx(1, 44100, 44100);
        const osc = ac.createOscillator();
        const comp = ac.createDynamicsCompressor();
        osc.connect(comp);
        comp.connect(ac.destination);
        osc.start(0);
        ac.startRendering();
      }
    } catch (e) { /* ignore */ }

    try {
      void navigator.userAgent;
      void navigator.languages;
      void navigator.hardwareConcurrency;
      void (navigator.plugins || []).length;
      void [screen.width, screen.height, screen.colorDepth];
      void new Date().getTimezoneOffset();
      if (navigator.mediaDevices) navigator.mediaDevices.enumerateDevices().catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // --- wiring ----------------------------------------------------------------
  const lastTyped = new WeakMap();

  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!el.matches || !el.matches("input, select, textarea")) return;
    beacon("field_focus", { f: fieldName(el) }, partial());
  }, true);

  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.matches || !el.matches("input, select, textarea")) return;
    const now = Date.now();
    if (now - (lastTyped.get(el) || 0) < 1200) return; // throttle per field
    lastTyped.set(el, now);
    const length = typeof el.value === "string" ? el.value.length : 0;
    beacon("typing", { f: fieldName(el), len: String(length) }, partial());
  }, true);

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el.matches || !el.matches("input[type=checkbox], input[type=radio], select")) return;
    beacon("choice", { f: fieldName(el) }, partial());
  }, true);

  document.addEventListener("submit", (e) => {
    const form = e.target;
    const names = Array.prototype.map
      .call(form.querySelectorAll("input, select, textarea"), fieldName)
      .join(",");
    beacon("form_submit", { fields: names.slice(0, 300) });
  }, true);

  beacon("page_view", { ref: document.referrer ? "internal" : "direct" });
  fingerprint();
  // A late second burst: retargeting pixels that fire after the page settles.
  setTimeout(() => beacon("engagement", {}, partial()), 2500);
})();
