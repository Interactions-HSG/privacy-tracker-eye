# Tracker Eye 👁

A Firefox research prototype that makes invisible online tracking **visible** by
rendering an anthropomorphic eye that watches you back — calmly when little
tracking is happening, intensely when you are being heavily tracked.

It is built for user studies on **anthropomorphic privacy cues**: whether a
social "someone is watching" signal raises privacy awareness and shifts
disclosure behaviour (the privacy paradox). The eye communicates purely through
behaviour — gaze, blinking, pupil, posture — **never through text**.

> Status: working prototype. Detection runs on real network/fingerprinting
> signals; the eye is driven by a continuous tracking-intensity score. Loads as
> an unpacked extension and packages as an `.xpi`/`.zip` for AMO.

---

## Table of contents

1. [Deliverable 1 — Which extension to fork (recommendation)](#1--recommendation-which-open-source-base-to-use)
2. [Deliverable 2 — Architecture overview](#2--architecture-overview)
3. [Deliverable 3 — Source code layout](#3--source-code-layout)
4. [Deliverable 4 — Tracking-intensity scoring](#4--tracking-intensity-scoring-logic)
5. [Deliverable 5 — Animated Tracker Eye](#5--animated-tracker-eye-implementation)
6. [Build instructions](#build-instructions)
7. [Deliverable 6 — Loading into Firefox](#6--loading-into-firefox-aboutdebugging)
8. [Deliverable 7 — Licensing implications](#7--licensing-implications)
9. [Using it in a user study](#using-it-in-a-user-study)
10. [Limitations & honest caveats](#limitations--honest-caveats)

---

## 1 · Recommendation: which open-source base to use

**Recommendation: do _not_ fork a whole extension. Reuse the mature open-source
tracker-detection _assets_ (the Ghostery/Disconnect tracker lists + the same
registrable-domain parser, `tldts`, that `@ghostery/adblocker` uses) inside a
small, new, TypeScript WebExtension.** That is exactly what this repository is.

### How the candidates were evaluated

| Criterion | Privacy Badger (EFF) | Disconnect | Ghostery (OSS parts) | **This approach** |
|---|---|---|---|---|
| Reliable 3rd-party tracker detection | ✅ heuristic, *learns over time* | ✅ list-based | ✅ list + engine | ✅ list-based (immediate) |
| **Deterministic from first visit** (vital for a controlled study) | ❌ cold-start: a fresh profile has learned almost nothing | ✅ | ✅ | ✅ |
| Firefox compatibility | ✅ | ✅ | ✅ | ✅ (MV2, native `browser.*`) |
| Codebase easy to *modify in isolation* | ⚠️ large JS app; a visual layer is entangled | ⚠️ dated | ⚠️ large, custom-licensed app | ✅ new code; eye layer fully isolated |
| TypeScript (requested) | ❌ JS | ❌ JS | partly | ✅ end-to-end TS |
| License clean for academic modification | ✅ GPL-3.0 (but viral) | ⚠️ list is CC BY-NC-SA | ✅ MPL-2.0 (engine) | ✅ MPL-2.0; reuses data only |

### Why forking an existing extension is the wrong tool here

* **Privacy Badger is algorithmic/learning-based.** Its strength (no blocklist)
  is a weakness for a *study*: on a fresh participant profile it has observed
  almost nothing, so the signal — and therefore the eye — would be weak and
  inconsistent across participants. A study needs the eye to react the *same
  strong way* every time a given site is visited.
* **Embedding a new visual layer inside a large MV2/MV3 application** (Privacy
  Badger, Ghostery, Disconnect) makes the modification hard to isolate and
  document, which the brief explicitly asks to avoid.
* **None of those app codebases are TypeScript**, which the brief prefers.

### What "reuse, don't rebuild" means concretely here

The brief's real requirement is *"don't build tracker detection from scratch if
a mature open-source implementation can be reused."* We honour that by reusing
the **mature detection intelligence**, not by re-deriving it:

* **Tracker list** — `src/data/trackers.ts` reproduces the categories and
  organisation mapping of the open-source **Disconnect** list and **Ghostery
  TrackerDB**. A curated subset (133 domains across every category) is bundled so
  the prototype produces strong signals **offline, deterministically, with no
  CDN fetch**. `npm run import:trackers` regenerates the **full** Disconnect list
  on demand (thousands of domains).
* **Domain parsing** — `tldts` (MIT), the same Public-Suffix/eTLD+1 parser used
  internally by `@ghostery/adblocker`, decides first-party vs. third-party.
* **Upgrade path** — `@ghostery/adblocker` (MPL-2.0) can be dropped into the one
  `classify()` function for production-grade matching (see
  `src/background/tracker-engine.ts`); nothing else changes.

The result: detection is **reused and mature**, while the **Tracker Eye visual
layer is 100 % new and isolated** — easy to study, modify, and license.

---

## 2 · Architecture overview

Tracker Eye observes (never blocks) network traffic and in-page API use,
collapses it into one continuous **tracking-intensity score ∈ [0, 1]** per tab,
and streams that score to a content-script overlay that animates the eye.

```
                          ┌───────────────────────── BACKGROUND (persistent) ─────────────────────────┐
   network requests  ───► │  webRequest.onBeforeRequest / onHeadersReceived  (NON-blocking observers)  │
   (every sub-resource)   │        │                                                                   │
                          │        ▼                                                                   │
                          │  tracker-engine.classify()   ── tldts eTLD+1  +  bundled tracker list      │
                          │        │  (3rd-party? which org/category?)                                 │
                          │        ▼                                                                   │
                          │  TabStateStore   (per-tab: orgs, domains, requests, 3p-cookies, fp)        │
                          │        │                                                                   │
                          │        ▼                                                                   │
                          │  computeIntensity()  ──►  IntensityResult { intensity, band, components }  │
                          └────────┬───────────────────────────────────────────────────▲──────────────┘
                                   │  tabs.sendMessage (throttled ~350 ms)              │ fingerprint-report
                                   ▼                                                    │
   ┌──────────────────── CONTENT SCRIPT (top frame, isolated world) ───────────────────┴───────────────┐
   │  EyeOverlay (Shadow DOM, pointer-events:none)        ◄── intensity-update + config                │
   │      └─ Eye (Canvas 2D state machine: gaze / blink / lids / pupil / drift)                         │
   │  mousemove ──► eye.setCursor()                                                                     │
   │  injects ▼                                                                                         │
   │  ┌──────────── PAGE WORLD ────────────┐                                                            │
   │  │ fingerprint-probe.js               │  wraps canvas / WebGL / AudioContext / enumeration APIs    │
   │  │   └─ window.postMessage(evidence) ─┼──► content relays ──► background                           │
   │  └────────────────────────────────────┘                                                           │
   └───────────────────────────────────────────────────────────────────────────────────────────────────┘

        POPUP (browser action): live signals + research controls (condition toggle, intensity
        override, corner/size, 1 Hz logging + JSON export) ◄──► background via typed messages
```

**Key design choices**

* **Observation, not blocking.** We attach non-blocking `webRequest` listeners.
  Installing Tracker Eye does **not** change the pages a participant sees — clean
  experimental control.
* **Continuous score, smoothed display.** The background computes a target
  intensity; the eye eases toward it so transitions feel organic, never snappy.
* **Isolation.** The eye lives in a Shadow DOM with `pointer-events:none`, so the
  page's CSS can't touch it and it can never intercept a click.
* **Typed message protocol.** Every cross-context message is one discriminated
  union (`src/shared/messages.ts`) — auditable and type-safe.

---

## 3 · Source code layout

```
src/
  manifest.json                 Firefox MV2 manifest
  shared/                       pure, browser-free, shared by all contexts
    types.ts                    data model (TabSignals, IntensityResult, Config…)
    messages.ts                 typed cross-context message protocol
    scoring-config.ts           ALL tunable scoring weights/curves (no logic)
    intensity.ts                ▶ Deliverable 4: scoring (pure functions)
  data/
    trackers.ts                 bundled tracker list (Disconnect/Ghostery subset)
  background/
    index.ts                    orchestration, config, throttled push, event log
    request-observer.ts         webRequest observers (detection core)
    tracker-engine.ts           classify(): 3rd-party + tracker lookup (tldts)
    tab-state.ts                per-tab signal accumulation, reset on navigation
  content/
    index.ts                    inject probe, mount eye, cursor, intensity updates
    fingerprint-probe.ts        page-world fingerprinting detector
    eye/
      behavior.ts               ▶ Deliverable 5a: intensity → behaviour params
      eye.ts                    ▶ Deliverable 5b: Canvas eye + state machine
      overlay.ts                Shadow-DOM host, corner placement, HiDPI canvas
  popup/                        research/debug panel (HTML/CSS/TS)
scripts/
  build.mjs                     esbuild bundler  →  dist/
  package.mjs                   zip dist/  →  web-ext-artifacts/*.zip
  import-trackers.mjs           regenerate the full Disconnect list
docs/test-page.html             local fixture that triggers trackers + fingerprinting
```

Everything that is **new for Tracker Eye** (the eye and its driving signal) is
under `content/eye/`, `shared/intensity.ts`, `shared/scoring-config.ts`, and the
fingerprint probe. The **reused detection intelligence** is `data/trackers.ts` +
`tldts`. The boundary between the two is the `IntensityResult` object.

---

## 4 · Tracking-intensity scoring logic

Implemented in `src/shared/intensity.ts`; all constants live in
`src/shared/scoring-config.ts` so a researcher can retune without touching logic.

**Inputs (per page load, reset on navigation):**

| Signal | Source |
|---|---|
| distinct tracker **organisations** (weighted by category) | webRequest + list |
| distinct tracker **domains** | webRequest + list |
| total **tracker requests** (beacon volume) | webRequest + list |
| distinct third-party **cookie-setting** domains | `onHeadersReceived` `Set-Cookie` |
| **fingerprinting** evidence (canvas/WebGL/audio/fonts/enumeration) | page-world probe |

**Model (transparent, monotonic, bounded):**

1. **Saturate** each raw count: `sat(x, k) = 1 − e^(−x/k)`. The first few
   trackers move the needle a lot; additional ones add progressively less. Each
   signal has its own `k` (e.g. ~3 organisations ≈ 0.63).
2. **Category weighting.** The "organisation count" fed to the curve is the *sum
   of per-organisation category weights*, so 3 advertising/fingerprinting
   trackers count for more than 3 consent/tag-manager scripts.
3. **Fingerprinting sub-score** rewards *breadth*: each technique saturates on
   its own count, then techniques are combined with weights (canvas 0.30, WebGL
   0.20, audio 0.20, fonts 0.15, enumeration 0.15).
4. **Combine** the five saturated sub-scores as a weighted average
   (organisations 0.30, fingerprinting 0.25, domains/requests/cookies 0.15 each).
5. **Peak blend.** Final = `0.85 × weighted + 0.15 × max(sub-scores)`, so a
   single extreme signal (e.g. aggressive canvas fingerprinting on an otherwise
   quiet page) can still raise the score — matching the intuition that covert
   fingerprinting alone is alarming.
6. **Clamp** to [0, 1]. Bands: `idle < 0.08 ≤ low < 0.40 ≤ medium < 0.70 ≤ high`.

The eye reads the **continuous** value; bands are only for labels/logging.

---

## 5 · Animated Tracker Eye implementation

The eye is a self-contained **Canvas-2D** renderer with a small behavioural state
machine. `behaviorFor(intensity)` maps the single continuous score to every
animation parameter — there are no discrete "modes", only regions of a
continuum. Mapping (brief → implementation):

| Brief | Low intensity | Medium | High |
|---|---|---|---|
| Gaze | wanders, looks away, can slide under the lid | occasional glances; mild cursor pursuit | locks a **direct** forward gaze; aggressive cursor pursuit |
| Cursor follow gain | ~0.12 (mostly ignores) | ~0.5 | ~1.0 (snaps onto cursor) |
| Blink frequency | frequent | medium | **rare** (staring) |
| Blink speed | slow, heavy/sleepy | medium | quick |
| Eyelids (openness) | half-open, relaxed | open | **wide** |
| Pupil | small/relaxed (0.42) | neutral | **dilated** (0.82) |
| Posture | **drifts partly off-screen** toward its corner | centred | comes forward + subtle alert micro-motion |
| Colour | calm steel-blue iris | warming | intense amber + faint bloodshot veins |

* **Gaze** blends a wandering saccade target with an "attend" target
  (cursor direction, or **(0,0) = forward stare** when the cursor is idle),
  weighted by `attention`, then eased toward with intensity-scaled smoothing.
* **Blinking** is a `1 → 0 → 1` lid curve on an intensity-scaled interval.
* **Drift** translates the whole Shadow-DOM host toward the off-screen direction
  of its anchored corner at low intensity (so it can "partially leave the
  screen"), returning to its corner as intensity rises.
* **Smoothing.** The eye eases its *displayed* intensity toward the target so it
  never snaps; all easing is frame-rate independent.

Rendering pauses automatically for hidden tabs (via `requestAnimationFrame`).

---

## Build instructions

Prerequisites: **Node ≥ 18** and a recent **Firefox** (≥ 140; today's release or ESR 140+).

```bash
npm install          # installs esbuild, typescript, tldts, types
npm run build        # bundles TypeScript → dist/   (this is what you load)
npm run typecheck    # optional: strict tsc --noEmit
npm run check        # typecheck + build
npm run watch        # rebuild on change during development
npm run package      # build + zip → web-ext-artifacts/tracker-eye-<v>.zip
npm run import:trackers   # optional: regenerate the FULL Disconnect list
```

The loadable, unpacked extension is the **`dist/`** directory.

---

## 6 · Loading into Firefox (`about:debugging`)

1. Run `npm install && npm run build`.
2. Open Firefox and go to **`about:debugging#/runtime/this-firefox`**.
3. Click **“Load Temporary Add-on…”**.
4. Select **`dist/manifest.json`**.
5. The 👁 toolbar icon appears. Open any normal website (or
   `docs/test-page.html`) and the eye renders in the top-right corner.
6. Click the toolbar icon for the live readout + research controls.

To test reactions immediately, open **`docs/test-page.html`** (File ▸ Open File)
and click **“Do everything (→ high)”**: it requests ~18 tracker domains and runs
canvas/WebGL/audio/enumeration fingerprinting, driving the eye to a hard stare.

> Temporary add-ons are removed when Firefox restarts (expected for development).
> For a persistent install during a study, use `web-ext sign` (AMO) or load the
> packaged zip through an unbranded/Developer-Edition build with
> `xpinstall.signatures.required = false`.

Reload after a rebuild via the **“Reload”** button on the add-on in
`about:debugging` (or `npx web-ext run` for auto-reload).

---

## 7 · Licensing implications

Full detail in **`NOTICE.md`**. Summary:

* **Tracker Eye's own code: MPL-2.0** (`LICENSE`) — file-level copyleft, freely
  combinable with other licenses, fine for academic modification and reuse.
* **`tldts`: MIT** — bundled, no obligations beyond attribution.
* **Bundled tracker list** reproduces the categories of the **Disconnect** list
  (code GPL-3.0 / list CC BY-NC-SA 4.0) and **Ghostery TrackerDB** (MPL-2.0). The
  default build ships only a small curated subset with attribution. If you run
  `npm run import:trackers` you bundle the actual Disconnect `services.json`,
  which is **CC BY-NC-SA 4.0** (non-commercial, share-alike) — fine for a
  non-commercial university study; for commercial distribution switch to Ghostery
  TrackerDB (MPL-2.0).
* **No application code was forked** from Privacy Badger, Disconnect, or Ghostery,
  so the project does **not** inherit those extensions' (often GPL) obligations.
  Only tracker *data* and an MIT *parser* are reused.
* **Privacy/IRB note:** Tracker Eye collects nothing off-device. All signals stay
  in memory; the optional 1 Hz log is in-memory only and exported manually by the
  operator. The manifest declares `data_collection_permissions: { required:
  ["none"] }` accordingly.

---

## Using it in a user study

The popup is built for experimental control:

* **Show the eye** — master on/off: run a **control (off)** vs. **treatment
  (on)** condition with identical detection/logging underneath.
* **Override intensity** — pin the eye to a fixed value (0–100 %) to script
  manipulation conditions independent of the actual site.
* **Corner / size** — placement and salience.
* **Log samples (1 Hz)** + **Export log (JSON)** — per-second
  `{t, pageDomain, intensity, band, counts}` for later analysis (e.g. correlating
  eye intensity with a disclosure-task outcome).

Reproducibility: detection is list-based, so a given site yields the same signal
for every participant (unlike a learning-based detector).

---

## Limitations & honest caveats

* **Bundled list is a subset** (133 domains). It covers the trackers on virtually
  every mainstream site, but for full coverage run `npm run import:trackers` or
  wire in `@ghostery/adblocker`.
* **Strict-CSP sites** (e.g. some of GitHub) can block the injected page-world
  fingerprint probe. Network/cookie detection and the eye itself are unaffected;
  only the fingerprinting sub-score may read 0 on those pages.
* **Third-party cookies** are detected by observing `Set-Cookie` *attempts* on
  third-party responses; with Firefox Total Cookie Protection the browser may
  still partition/block them. The *attempt* is the tracking signal we want.
* **Not a blocker.** Tracker Eye deliberately does not block anything — it is a
  measurement-and-display instrument for research, not a protection tool.
* **Temporary add-on** resets on restart; sign it for long studies.

---

*Built as a research prototype for studying anthropomorphic privacy cues and the
privacy paradox.*
