# Nimbus Market — the study fixture

A fictional online shop, used as the site participants fill in during the
Tracker Eye study. It exists so that both study conditions (eye / no eye) browse
**exactly the same pages**, with the same tracking, in the same order.

```bash
npm run study          # serves this folder on http://localhost:8137
npm run study -- 9000  # …on another port
```

Then open <http://localhost:8137/> in the Firefox profile that has Tracker Eye
loaded (see the root README for loading instructions).

> Serve it over http rather than opening the files directly: on `file://` URLs
> Firefox treats content scripts and `webRequest` differently, and the page has
> no registrable domain, so the extension's first-party/third-party split does
> not behave the way it will in the study.

## The flow

| Step | Page | Discloses | Tracking profile |
|---|---|---|---|
| — | `index.html` | nothing (landing) | mixed |
| 1 | `signup.html` | name, e-mail, password, date of birth, gender | **Google-heavy** |
| 2 | `profile.html` | street, postcode, city, country, phone, occupation, household size | mixed |
| 3 | `interests.html` | hobbies, favourite category, budget, free-text bio, newsletter opt-in | **Amazon-heavy** |
| 4 | `connect.html` | connected accounts, a *friend's* e-mail address, ad-personalisation consent | mixed |
| — | `done.html` | nothing — deliberately no recap of what was entered | mixed |

`done.html` does not summarise the entries on purpose: the study measures what
participants *remember* disclosing, so the site must not remind them.

The per-page tracking profile is set on the script tag, e.g.

```html
<script src="assets/mock-tracking.js" data-profile="google"></script>
```

Profiles are `google`, `amazon` and `mixed` (`assets/mock-tracking.js`). They
decide which organisation dominates the page — which is what the eye's **auto**
skin reads: the sign-up step is watched by a Google-coloured eye, the interests
step by an Amazon-coloured one.

## What the fixture does and does not do

* **Never submits.** "Continue" cancels the submit and navigates (`assets/next.js`).
  Nothing typed is stored, kept in a URL, or sent to any server.
* **Beacons field names, never values.** `assets/mock-tracking.js` fires pixels
  to the real tracker hostnames on page view, field focus, typing (throttled),
  dropdown/tick-box choices and submit, carrying the page, the event, the field
  *name* and a character count. Read the file — there is no path from a
  `.value` to a URL.
* **Fingerprints on load** (canvas, WebGL, audio, enumeration), so the
  extension's fingerprinting sub-score rises the way it does on a real site.
* The beacon requests **fail** — no such endpoint exists. Tracker Eye only needs
  to observe the attempt. To keep them inside the lab entirely, point those
  hostnames at `127.0.0.1` in `/etc/hosts`; they are still observed.
* `fixture-notes.html` (linked as "Privacy" in the footer) explains all of the
  above in plain language, so the fixture is honest to anyone who looks — without
  a banner that would prime participants before the task.

## Adapting it for a run

* **More pages / other data types**: copy a step, change the fields, and point
  the previous step's `data-next` at it. Any `<input>`, `<select>`, `<textarea>`
  or contenteditable is classified automatically by the extension
  (`src/content/fields.ts`) — a field with a sensible `autocomplete`, `name` or
  `<label>` is recognised without further wiring.
* **Control condition**: same site, extension installed with *Show the eye*
  switched off. Detection and the disclosure log keep running, so both groups
  produce the same ground-truth data.
* **Ground truth**: with *Log samples* on, the popup's **Export log (JSON)**
  yields per-second intensity samples plus a `disclosures` array —
  `{t, pageDomain, kind, label, chars, sensitivity}` per field filled in. That is
  the list to check recall answers against.
