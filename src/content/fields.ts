// Disclosure-field detection and classification.
// -----------------------------------------------------------------------------
// Decides (a) whether a focused element is a field through which a participant
// discloses something about themselves, (b) *what kind* of thing it asks for and
// how sensitive that is, and (c) where on screen the text being typed currently
// sits, so the eye can read along with the caret.
//
// PRIVACY INVARIANT (holds for this whole module): the typed value is used only
// to measure — its length, and the pixel width of the text before the caret. It
// is never stored, never rendered, and never sent anywhere. For password fields
// the width is measured from bullets, not from the characters.

import type { DisclosureKind } from "../shared/types";

export interface FieldInfo {
  kind: DisclosureKind;
  /** Visible label of the field (site text), for the research log. */
  label: string;
  /** How revealing this field is, in [0,1]. Drives how hard the eye stares. */
  sensitivity: number;
}

export interface Vec {
  x: number;
  y: number;
}

/**
 * How revealing each kind of disclosure is. These are the study's own
 * judgement calls, kept in one table so they can be retuned without touching
 * logic (cf. shared/scoring-config.ts for the tracking side).
 */
export const KIND_SENSITIVITY: Record<DisclosureKind, number> = {
  payment: 1.0,
  identifier: 1.0,
  password: 0.95,
  "account-link": 0.85,
  birthday: 0.8,
  address: 0.8,
  phone: 0.75,
  email: 0.7,
  gender: 0.6,
  name: 0.6,
  preferences: 0.45,
  other: 0.35,
};

/** Input types that carry no disclosure (or that we cannot observe). */
const IGNORED_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "reset",
  "button",
  "image",
  "file",
  "range",
  "color",
]);

/** Is this element something a participant discloses through? */
export function isDisclosureField(node: EventTarget | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  switch (node.tagName) {
    case "TEXTAREA":
    case "SELECT":
      return true;
    case "INPUT":
      return !IGNORED_INPUT_TYPES.has((node as HTMLInputElement).type);
    default:
      return false;
  }
}

// --- classification ----------------------------------------------------------

/** Everything the page tells us *about* the field (never its value). */
function haystack(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  const parts = [
    input.name ?? "",
    el.id,
    input.placeholder ?? "",
    el.getAttribute("autocomplete") ?? "",
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("data-testid") ?? "",
    labelText(el),
    el.closest("fieldset")?.querySelector("legend")?.textContent ?? "",
  ];
  return parts.join(" ").toLowerCase();
}

/** "Connect your X account" — the one disclosure a tick box really can make. */
const ACCOUNT_LINK = /connect|link.?account|oauth|sign.?in.?with|\bsso\b|verkn/;

const PATTERNS: ReadonlyArray<readonly [DisclosureKind, RegExp]> = [
  ["payment", /\b(cc-|card|credit|debit|cvc|cvv|iban|paypal|billing|payment)\b|creditcard|kreditkarte/],
  ["identifier", /\b(ssn|social.?security|passport|national.?id|tax.?id|ahv|licen[cs]e)\b|personalausweis/],
  ["password", /pass(word|phrase)|\bpin\b|passwort/],
  ["email", /e-?mail/],
  ["phone", /\bphone\b|mobile|telephone|\btel\b|handy|telefon/],
  ["birthday", /birth|\bdob\b|geburt|\bage\b|alter/],
  ["address", /address|street|\bcity\b|\bzip\b|postal|postcode|country|province|\bstate\b|adresse|strasse|\bort\b|\bplz\b/],
  ["gender", /gender|\bsex\b|pronoun|salutation|\btitle\b|anrede|geschlecht/],
  ["account-link", ACCOUNT_LINK],
  ["name", /\bname\b|user.?name|first|last|given|family|surname|nick|vorname|nachname/],
  ["preferences", /interest|hobby|hobbies|prefer|favou?rite|newsletter|subscribe|topic|categor|marketing|opt.?in|consent/],
];

/** autocomplete tokens are the most reliable signal when a site sets them. */
const AUTOCOMPLETE_KINDS: Record<string, DisclosureKind> = {
  name: "name",
  "given-name": "name",
  "family-name": "name",
  "additional-name": "name",
  nickname: "name",
  username: "name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  bday: "birthday",
  "bday-day": "birthday",
  "bday-month": "birthday",
  "bday-year": "birthday",
  sex: "gender",
  "honorific-prefix": "gender",
  "new-password": "password",
  "current-password": "password",
  "street-address": "address",
  "address-line1": "address",
  "address-line2": "address",
  "postal-code": "address",
  "address-level1": "address",
  "address-level2": "address",
  country: "address",
  "country-name": "address",
  organization: "other",
};

function classifyKind(el: HTMLElement, hay: string): DisclosureKind {
  const input = el as HTMLInputElement;
  const type = el.tagName === "INPUT" ? input.type : "";

  // 1. Unambiguous input types.
  if (type === "password") return "password";
  if (type === "email") return "email";
  if (type === "tel") return "phone";

  // 2. Standard autocomplete tokens (a site that sets them means them).
  for (const token of (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/)) {
    const kind = AUTOCOMPLETE_KINDS[token];
    if (kind) return kind;
  }

  // 3. A tick box records a decision, never an e-mail address or a birthday —
  //    however much its label talks about one ("mail me offers" is an opt-in).
  if (type === "checkbox" || type === "radio") {
    return ACCOUNT_LINK.test(hay) ? "account-link" : "preferences";
  }

  // 4. Free-text heuristics over name/id/placeholder/label, most sensitive
  //    pattern first so "card holder name" reads as payment, not as a name.
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(hay)) return kind;
  }

  // 5. Structural fallbacks: a date input is almost always a birthday in a
  //    sign-up flow, and an unlabelled dropdown expresses a preference.
  if (type === "date" || type === "month") return "birthday";
  if (el.tagName === "SELECT") return "preferences";
  return "other";
}

/** The field's visible label, trimmed to something loggable. */
function labelText(el: HTMLElement): string {
  const labelled = el as HTMLInputElement;
  const own = labelled.labels?.[0]?.textContent;
  if (own) return own;

  const ariaId = el.getAttribute("aria-labelledby");
  if (ariaId) {
    const text = ariaId
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (text.trim()) return text;
  }

  const wrapping = el.closest("label")?.textContent;
  if (wrapping) return wrapping;
  return el.getAttribute("aria-label") ?? labelled.placeholder ?? "";
}

function tidy(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 64 ? `${collapsed.slice(0, 63)}…` : collapsed;
}

/** Classify a field: what it asks for, what it is called, how revealing it is. */
export function describeField(el: HTMLElement): FieldInfo {
  const hay = haystack(el);
  const kind = classifyKind(el, hay);
  const input = el as HTMLInputElement;
  const label = tidy(labelText(el) || input.name || el.id || kind);
  return { kind, label, sensitivity: KIND_SENSITIVITY[kind] };
}

// --- what has been entered, and where it sits on screen ----------------------

/** Number of characters currently in the field. Never the characters. */
export function charCount(el: HTMLElement): number {
  if (el.isContentEditable) return (el.textContent ?? "").length;
  const input = el as HTMLInputElement;
  if (el.tagName === "SELECT") {
    const select = el as HTMLSelectElement;
    return select.selectedIndex > 0 ? 1 : 0; // "chose something" vs. "untouched"
  }
  if (input.type === "checkbox" || input.type === "radio") return input.checked ? 1 : 0;
  return (input.value ?? "").length;
}

/** Shared measuring context — never attached to the document. */
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return 0;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Caret offset, or the end of the text when the field does not expose one. */
function caretIndex(el: HTMLInputElement, fallback: number): number {
  try {
    // selectionStart is not available on email/number/date inputs.
    return el.selectionStart ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * The point on screen the eye should be reading: the caret for text fields, the
 * selection for rich text, the centre of the control for tick boxes/dropdowns.
 */
export function readPointFor(el: HTMLElement, rect: DOMRect): Vec {
  const middle: Vec = { x: rect.left + Math.min(rect.width * 0.5, 40), y: rect.top + rect.height / 2 };

  if (el.isContentEditable) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const r = selection.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) {
        return { x: clamp(r.right, rect.left + 4, rect.right - 4), y: clamp(r.top + r.height / 2, rect.top + 6, rect.bottom - 6) };
      }
    }
    return middle;
  }

  const tag = el.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA") return middle;

  const input = el as HTMLInputElement;
  if (tag === "INPUT" && (input.type === "checkbox" || input.type === "radio")) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  const value = input.value ?? "";
  const caret = caretIndex(input, value.length);
  // A password's *shape* is all the eye gets to see — measure bullets.
  const upTo = input.type === "password" ? "•".repeat(caret) : value.slice(0, caret);

  const style = window.getComputedStyle(el);
  const font = style.font || `${style.fontSize} ${style.fontFamily}`;
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const lines = upTo.split("\n");
  const lastLine = lines[lines.length - 1];
  const x = clamp(
    rect.left + padLeft + textWidth(lastLine, font) - (el.scrollLeft || 0),
    rect.left + 4,
    rect.right - 6,
  );

  if (tag !== "TEXTAREA") return { x, y: rect.top + rect.height / 2 };

  const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 14) * 1.4;
  const padTop = parseFloat(style.paddingTop) || 0;
  const y = clamp(
    rect.top + padTop + lineHeight * (lines.length - 0.5) - (el.scrollTop || 0),
    rect.top + 6,
    rect.bottom - 6,
  );
  return { x, y };
}
