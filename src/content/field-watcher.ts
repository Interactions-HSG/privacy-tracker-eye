// Close inspection: sending the eye to whatever the participant is filling in.
// -----------------------------------------------------------------------------
// This is the v0.2 feature. The eye no longer only hovers in a corner reacting
// to *how much* tracking a page does; the moment a participant starts entering
// something about themselves, it leaves the corner, flies to that exact field
// and reads along with the caret. The hypothesis is that a concrete
// consequence ("this is being read as I type it") lands harder than an abstract
// intensity signal.
//
// This module owns only the DOM plumbing: which element is being filled in,
// where it is, and when to send the eye home again. How the eye behaves once it
// gets there lives in eye/behavior.ts; what a field asks for lives in fields.ts.

import type { InspectionGeometry, InspectionTarget } from "./eye/eye";
import {
  charCount,
  describeField,
  isDisclosureField,
  readPointFor,
  type FieldInfo,
} from "./fields";
import type { DisclosureKind } from "../shared/types";

export interface FieldWatcherHooks {
  /** Send the eye to a field, or home again with null. */
  onInspect: (target: InspectionTarget | null) => void;
  /** Report a completed disclosure (kind/label/length — never the value). */
  onDisclosure: (
    kind: DisclosureKind,
    label: string,
    chars: number,
    sensitivity: number,
  ) => void;
}

/** How long the eye keeps reading a field after focus moves away. */
const RETURN_DELAY_MS = 1100;
/** Typing pause after which the entry counts as "made" and is logged. */
const REPORT_IDLE_MS = 1200;

interface ActiveField {
  el: HTMLElement;
  info: FieldInfo;
  /** performance.now() of the last keystroke in this field. */
  lastInput: number;
  /** Last character count we reported, so an entry is logged once. */
  reportedChars: number;
}

export class FieldWatcher {
  private enabled = false;
  private active: ActiveField | null = null;
  private returnTimer = 0;
  private reportTimer = 0;

  constructor(private readonly hooks: FieldWatcherHooks) {}

  /** Attach the listeners (capturing, so a page cannot stop them bubbling). */
  install(): void {
    document.addEventListener("focusin", this.onFocusIn, true);
    document.addEventListener("focusout", this.onFocusOut, true);
    document.addEventListener("input", this.onInput, true);
    document.addEventListener("change", this.onChange, true);
  }

  /**
   * Inspection is only armed on pages where somebody is actually watching: an
   * untracked page gets the relaxed corner eye, which is the honest signal.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.clearActive();
      return;
    }
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && isDisclosureField(focused)) this.begin(focused);
  }

  // --- events ----------------------------------------------------------------
  private readonly onFocusIn = (event: Event): void => {
    if (!this.enabled) return;
    const el = event.target;
    if (!isDisclosureField(el)) return;
    this.begin(el);
  };

  private readonly onFocusOut = (event: Event): void => {
    if (!this.active || event.target !== this.active.el) return;
    this.flush();
    // Linger: the eye finishes reading before it flies back to its corner.
    window.clearTimeout(this.returnTimer);
    this.returnTimer = window.setTimeout(() => this.clearActive(), RETURN_DELAY_MS);
  };

  private readonly onInput = (event: Event): void => {
    if (!this.enabled) return;
    const el = event.target;
    if (!isDisclosureField(el)) return;
    if (this.active?.el !== el) this.begin(el); // e.g. autofill without focus
    if (!this.active) return;
    this.active.lastInput = performance.now();
    window.clearTimeout(this.reportTimer);
    this.reportTimer = window.setTimeout(() => this.flush(), REPORT_IDLE_MS);
  };

  private readonly onChange = (event: Event): void => {
    if (!this.enabled) return;
    const el = event.target;
    if (!isDisclosureField(el)) return;
    if (this.active?.el !== el) this.begin(el);
    if (!this.active) return;
    // A dropdown/tick box is a finished decision — log it immediately.
    this.active.lastInput = performance.now();
    this.flush();
  };

  // --- state -----------------------------------------------------------------
  private begin(el: HTMLElement): void {
    if (this.active?.el === el) {
      window.clearTimeout(this.returnTimer); // focus came back; stay put
      return;
    }
    this.flush(); // whatever was in the previous field is now final
    window.clearTimeout(this.returnTimer);

    const info = describeField(el);
    this.active = {
      el,
      info,
      lastInput: performance.now(),
      reportedChars: 0,
    };
    this.hooks.onInspect({
      sensitivity: info.sensitivity,
      read: () => this.geometry(),
    });
  }

  private clearActive(): void {
    window.clearTimeout(this.returnTimer);
    window.clearTimeout(this.reportTimer);
    this.flush();
    this.active = null;
    this.hooks.onInspect(null);
  }

  /** Report the current entry if it changed since the last report. */
  private flush(): void {
    window.clearTimeout(this.reportTimer);
    const a = this.active;
    if (!a) return;
    const chars = charCount(a.el);
    if (chars === 0 || chars === a.reportedChars) return;
    a.reportedChars = chars;
    this.hooks.onDisclosure(a.info.kind, a.info.label, chars, a.info.sensitivity);
  }

  /**
   * Live geometry of the field, re-read by the eye every frame. Returning null
   * ends the inspection — the field was removed or scrolled out of sight.
   */
  private geometry(): InspectionGeometry | null {
    const a = this.active;
    if (!a || !a.el.isConnected) return null;

    const view = document.documentElement;
    const vw = view?.clientWidth || window.innerWidth;
    const vh = view?.clientHeight || window.innerHeight;

    const rect = a.el.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) return null;
    if (rect.bottom < 0 || rect.top > vh) return null;
    if (rect.right < 0 || rect.left > vw) return null;

    return {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      point: readPointFor(a.el, rect),
      lastInput: a.lastInput,
    };
  }
}
