# Tracker Eye — third-party notices & licensing

Tracker Eye is a research prototype. This file records the provenance and
licensing of everything it reuses, so the project can be redistributed for
academic research without ambiguity.

## This project's own code
Licensed under the **Mozilla Public License 2.0 (MPL-2.0)** — see `LICENSE`.
MPL-2.0 is file-level copyleft: you may combine it with code under other
licenses, and it is compatible with academic reuse and modification.

## Reused components

| Component | What it provides | License | How it is used |
|---|---|---|---|
| **`tldts`** | Registrable-domain (eTLD+1 / Public Suffix List) parsing | MIT | Bundled at build time; used to decide first-party vs. third-party. This is the same domain parser used internally by `@ghostery/adblocker`. |
| **Disconnect tracking-protection list** (`services.json`) | Tracker domain → organisation → category data | Code: GPL-3.0 · List: CC BY-NC-SA 4.0 (with GPL-3.0 alternative) | The bundled `src/data/trackers.ts` is a **curated subset** reproducing this list's categories. `npm run import:trackers` can regenerate the full list. |
| **Ghostery TrackerDB** (reference) | Tracker domain/category database | MPL-2.0 | Cited as an interchangeable source for the same data shape; not bundled by default. |
| **`@ghostery/adblocker`** (optional upgrade path) | Production-grade request matching engine | MPL-2.0 | Documented drop-in replacement for the detection core; not a dependency of the default build. |

## Licensing implications you should know

- **Default build is clean for research.** It bundles only `tldts` (MIT) plus a
  hand-curated subset of tracker domains. Curated factual domain→category data
  of this kind is not itself the Disconnect file and the subset is small; still,
  attribute Disconnect/Ghostery as the conceptual source (done above).
- **If you run `npm run import:trackers`** you bundle the *actual* Disconnect
  `services.json`. That list is **CC BY-NC-SA 4.0** (non-commercial,
  share-alike) with a GPL-3.0 alternative. For a non-commercial university study
  this is fine; if you ever distribute commercially, switch the data source to
  Ghostery TrackerDB (MPL-2.0) or license accordingly.
- **If you adopt `@ghostery/adblocker`**, that engine and its lists are MPL-2.0;
  keep their notices and make modified MPL files available on request.
- **No code was forked from Privacy Badger, Disconnect, or Ghostery
  extensions.** Tracker Eye is original code that *reuses tracker-detection
  data/parsers*, which keeps the Tracker Eye visual layer fully isolated and
  avoids inheriting GPL obligations from those extensions' application code.
