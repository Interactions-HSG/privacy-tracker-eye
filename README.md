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

## What is new in 0.2

Three additions, all aimed at one hypothesis: **making the consequence of
tracking concrete should beat signalling its intensity.**

* **Close inspection.** The eye no longer only floats in its corner reacting to
  *how much* a page tracks. The moment you start filling in a field, it leaves
  the corner, **flies to that field and reads along with your caret** — lids
  wide, pupil dilated, barely blinking — then sweeps back over what you already
  typed when you pause. How hard it stares scales with what the field asks for:
  a hobby tick box barely registers, a date of birth gets a stare.
  ([§5b](#5b--close-inspection-the-eye-reads-what-you-type))
* **Skins.** The eye can wear the colours of the company doing the watching —
  Google, Amazon, or neutral — toggled in the popup. In **auto** mode it takes
  on the palette of whichever organisation is actually the heaviest tracker on
  the current page. ([§5c](#5c--skins-whose-eye-is-this))
* **A study fixture site.** `docs/study-site/` is a fictional shop ("Nimbus
  Market") with a four-step sign-up flow that asks for progressively more
  personal data, with mocked tracking on every page. `npm run study` serves it.
  ([§8](#8--the-study-fixture-site))

A by-product that the study needs anyway: the extension now keeps a
**disclosure log** — for every field filled in, its *kind* (name, e-mail,
birthday…), its visible label and a character count, with a timestamp. That is
the ground truth to check recall answers against. **What is typed is never
read, stored or transmitted** — only measured.

---

## Table of contents

1. [Deliverable 1 — Which extension to fork (recommendation)](#1--recommendation-which-open-source-base-to-use)
2. [Deliverable 2 — Architecture overview](#2--architecture-overview)
3. [Deliverable 3 — Source code layout](#3--source-code-layout)
4. [Deliverable 4 — Tracking-intensity scoring](#4--tracking-intensity-scoring-logic)
5. [Deliverable 5 — Animated Tracker Eye](#5--animated-tracker-eye-implementation)
   * [5b — Close inspection](#5b--close-inspection-the-eye-reads-what-you-type)
   * [5c — Skins](#5c--skins-whose-eye-is-this)
6. [Build instructions](#build-instructions)
7. [Deliverable 6 — Loading into Firefox](#6--loading-into-firefox-aboutdebugging)
8. [Deliverable 7 — Licensing implications](#7--licensing-implications)
9. [The study fixture site](#8--the-study-fixture-site)
10. [Using it in a user study](#using-it-in-a-user-study)
11. [Limitations & honest caveats](#limitations--honest-caveats)

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
   │      └─ Eye (Canvas 2D state machine: gaze / blink / lids / pupil / placement / skin)              │
   │  mousemove ──► eye.setCursor()                                                                     │
   │  FieldWatcher  focusin/input/change ──► fields.classify() ──► eye.inspect(field)                   │
   │      └─ kind + label + length ──► disclosure-report ──► background log  (never the value)          │
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
  page's CSS can't touch it and it can never intercept a click — including while
  it is parked next to the field you are typing into.
* **The typed value never leaves the page.** The field watcher measures what is
  entered (how many characters, where the caret is on screen) but never reads
  the content out: nothing crosses the content-script boundary except the
  field's *kind*, its visible label and a count. Passwords are measured from
  bullets.
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
    fields.ts                   ▶ what a form field asks for + where the caret is
    field-watcher.ts            ▶ focus/typing → send the eye there, log the kind
    eye/
      behavior.ts               ▶ Deliverable 5a: intensity → behaviour params
      eye.ts                    ▶ Deliverable 5b: Canvas eye + state machine
      overlay.ts                Shadow-DOM host, HiDPI canvas
      skins.ts                  ▶ palettes: neutral / Google / Amazon / auto
  popup/                        research/debug panel (HTML/CSS/TS)
scripts/
  build.mjs                     esbuild bundler  →  dist/
  package.mjs                   zip dist/  →  web-ext-artifacts/*.zip
  import-trackers.mjs           regenerate the full Disconnect list
  serve.mjs                     static server for the study fixture
docs/test-page.html             local fixture that triggers trackers + fingerprinting
docs/study-site/                ▶ "Nimbus Market": the study site (see §8)
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

### 5b · Close inspection: the eye reads what you type

`src/content/field-watcher.ts` + `src/content/fields.ts` + the inspection branch
of `behavior.ts` / `eye.ts`.

The corner eye answers *"how closely is this page watching me?"*. Close
inspection answers the sharper question *"what is it watching me do?"* — which
is the manipulation the 0.2 study design rests on.

**Trigger.** Any `focusin` / `input` / `change` on an `<input>`, `<textarea>`,
`<select>` or contenteditable, captured at the document. Inspection is armed
only while the page's intensity is above the `idle` band: on a page nobody
tracks, the eye stays relaxed in its corner even while you fill in a form. That
keeps the cue honest, and makes "tracked page" vs. "untracked page" a usable
within-subject contrast.

**Flight.** The overlay host is pinned to the viewport origin and the eye
positions *itself*, so the corner anchor, the low-intensity drift and the flight
to a field are all the same eased motion — it never teleports. It parks to the
right of the field, or left / above / below when there is no room, shrinking to
~55 % so it sits beside an input without covering the page. The field's
geometry is re-read every frame, so the eye follows scrolling and layout shifts,
and flies home when the field scrolls out of sight.

**The look itself.** While inspecting: lids at maximum, pupil 0.68–0.92 of the
iris, blink interval 9–20 s (it does not want to miss a keystroke), no drift,
gaze pinned to the caret with over-gain. When you pause for more than ~0.65 s,
the gaze sweeps back and forth over what you already typed — the "let me read
that again" pass. On blur it keeps reading for ~1.1 s before flying home.

**Sensitivity.** How extreme all of that gets scales with what the field asks
for (`KIND_SENSITIVITY` in `fields.ts`):

| Kind | Sensitivity | Recognised from |
|---|---|---|
| payment, identifier | 1.00 | `cc-*` autocomplete, card/IBAN/SSN/passport wording |
| password | 0.95 | `type="password"` |
| account-link | 0.85 | "connect / link account / sign in with" on a tick box |
| birthday, address | 0.80 | `bday`/`street-address`/… autocomplete, date inputs |
| phone | 0.75 | `type="tel"`, phone wording |
| email | 0.70 | `type="email"` |
| gender, name | 0.60 | `sex`/`given-name`/… autocomplete, label wording |
| preferences | 0.45 | tick boxes, dropdowns, "interests / newsletter / opt-in" |
| other | 0.35 | anything else |

Classification runs `type` → `autocomplete` token → label/name/placeholder
regex → structural fallback, most sensitive pattern first (so "Name on card"
reads as payment, not as a name), and a tick box can never be classified as an
e-mail address however much its label mentions one.

**What is recorded.** One `disclosure-report` per field per editing session,
carrying `{kind, label, chars, sensitivity}`. The background stamps it with the
time and page domain and appends it to the exportable log; the popup lists the
fields filled in on the current page. **The typed value is never read out of the
page** — the only thing derived from it is a length and a caret x-position, and
for password fields even that is measured from bullets.

### 5c · Skins: whose eye is this?

`src/content/eye/skins.ts`. A skin is a palette plus at most two ornaments
(brand-coloured segments around the iris rim, an accent arc under the eye). No
logotypes, no text — the eye still communicates only through behaviour and
colour.

| Skin | Iris (calm → alert) | Ornament |
|---|---|---|
| `neutral` | steel blue → amber | — |
| `google` | `#4285F4` → `#EA4335` | four-colour rim segments, slowly turning |
| `amazon` | `#146EB4` → `#FF9900` | warm arc under the eye |
| `auto` | follows the page | the skin of whichever organisation tracks this page hardest |

`auto` reads `IntensityResult.dominantOrganization` — tracker requests weighted
by category — so on a Google-heavy page a Google-coloured eye reads your e-mail
address over your shoulder, and on an Amazon-heavy page an Amazon-coloured one
reads your interests. That is the "concrete consequence" manipulation in its
strongest form, and it needs no per-site configuration.

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
npm run study        # serve the study fixture → http://localhost:8137
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

## 8 · The study fixture site

`docs/study-site/` is **Nimbus Market**, a fictional shop that exists so both
study conditions fill in exactly the same forms, with the same tracking, in the
same order. Full detail in `docs/study-site/README.md`.

```bash
npm run study        # http://localhost:8137
```

| Step | Page | Discloses | Tracking profile |
|---|---|---|---|
| — | `index.html` | nothing (landing) | mixed |
| 1 | `signup.html` | name, e-mail, password, date of birth, gender | **Google-heavy** |
| 2 | `profile.html` | street, postcode, city, country, phone, occupation, household | mixed |
| 3 | `interests.html` | hobbies, category, budget, free-text bio, newsletter opt-in | **Amazon-heavy** |
| 4 | `connect.html` | connected accounts, a *friend's* e-mail, ad-personalisation consent | mixed |
| — | `done.html` | nothing — deliberately no recap | mixed |

With the eye's skin on **auto**, step 1 is watched by a Google-coloured eye and
step 3 by an Amazon-coloured one, because that is who actually loads on those
pages. `done.html` does not summarise what was entered: the study measures what
participants *remember* disclosing, so the site must not remind them.

The fixture **never submits anything** — "Continue" cancels the submit and
navigates, so nothing typed is stored, sent, or put in a URL. Its mock tracking
beacons carry the page, the event, the *name* of the field and a character
count, to the real tracker hostnames (the extension classifies by domain, so a
local stand-in would not be recognised); those requests fail, which is fine
because the extension only needs to observe the attempt. `fixture-notes.html`,
linked as "Privacy" in the footer, says all of this in plain language — honest
to anyone who looks, without a banner that would prime participants.

> Serve it over http rather than opening the files: on `file://` URLs Firefox
> treats content scripts and `webRequest` differently and the page has no
> registrable domain, so first-party/third-party classification does not behave
> the way it will in the study.

`docs/test-page.html` remains as the quick bench for driving the eye to
extremes by hand.

---

## Using it in a user study

The popup is built for experimental control:

* **Show the eye** — master on/off: run a **control (off)** vs. **treatment
  (on)** condition with identical detection/logging underneath.
* **Fly to fields I fill in** — close inspection on/off. Off gives you the 0.1
  behaviour (corner eye, intensity only), which is the natural comparison
  condition for H1: *does showing the consequence beat showing the intensity?*
* **Skin** — neutral / Google / Amazon / auto: whether the eye is anonymous or
  visibly belongs to the company doing the tracking.
* **Override intensity** — pin the eye to a fixed value (0–100 %) to script
  manipulation conditions independent of the actual site. Note that inspection
  is armed off this value too, so an override of 0 also disables the flight.
* **Corner / size** — placement and salience.
* **Log samples (1 Hz)** + **Export log (JSON)** — per-second
  `{t, pageDomain, intensity, band, counts}` **plus** a `disclosures` array of
  `{t, pageDomain, kind, label, chars, sensitivity}`, one entry per field filled
  in. The second array is the ground truth to score recall answers against:
  what participants actually disclosed, versus what they report disclosing.

A three-condition design falls straight out of those switches: **no eye** /
**corner eye only** (intensity signalling) / **eye + close inspection**
(consequence signalling).

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
* **Close inspection sees the top frame only.** Fields inside cross-origin
  iframes (hosted checkout forms, embedded sign-up widgets) are invisible to the
  watcher, because the content script runs with `all_frames: false`. Fields
  inside a page's own shadow DOM are also missed: `focusin` retargets to the
  host element. Both are fine for the fixture; check them if you point the study
  at a real site.
* **Field classification is heuristic.** It reads `type`, `autocomplete`,
  labels, names and placeholders. A site with unlabelled, obfuscated inputs
  yields `other` (sensitivity 0.35) — the eye still flies over, it just does not
  know what it is reading.
* **Character counts are approximate for exotic controls.** A `<select>` or tick
  box is logged as 1 character ("chose something"), not as the option's text.
* **Temporary add-on** resets on restart; sign it for long studies.

---

*Built as a research prototype for studying anthropomorphic privacy cues and the
privacy paradox.*
