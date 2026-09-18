// Eye skins — "whose eye is this?".
// -----------------------------------------------------------------------------
// The behaviour model (behavior.ts) says how the eye *moves*; a skin says how it
// *looks*. Skins exist because the study hypothesis is that concrete
// consequences beat abstract intensity: an eye wearing the colours of the
// company that is actually watching the page ("Google is reading what you type")
// is a far more concrete cue than a generic amber iris.
//
// Skins are pure palettes + two optional ornaments (a rim ring, an under-eye
// accent arc). They never render text or a logotype — the eye communicates
// through behaviour and colour only.

import type { EyeSkin } from "../../shared/types";

export type Rgb = readonly [number, number, number];

export interface SkinPalette {
  id: Exclude<EyeSkin, "auto">;
  /** Human-readable, for the popup/log only. */
  label: string;
  /** Eye white. */
  sclera: string;
  /** Eyelid outline. */
  lid: string;
  /** Iris colour at rest … */
  irisCalm: Rgb;
  /** … and at full tracking intensity. */
  irisAlert: Rgb;
  pupil: string;
  /** Glow ring colour at high intensity, as "r,g,b". */
  glow: string;
  /** Optional brand-coloured segments around the iris rim. */
  ring?: readonly string[];
  /** Optional accent arc drawn under the eye. */
  accent?: string;
}

const NEUTRAL: SkinPalette = {
  id: "neutral",
  label: "Neutral",
  sclera: "#fbfdff",
  lid: "rgba(20,24,33,0.85)",
  irisCalm: [58, 120, 208],
  irisAlert: [214, 119, 47],
  pupil: "#08090c",
  glow: "255,140,70",
};

/** Alphabet's four brand colours; the iris cools blue and flares red. */
const GOOGLE: SkinPalette = {
  id: "google",
  label: "Google",
  sclera: "#ffffff",
  lid: "rgba(32,33,36,0.88)",
  irisCalm: [66, 133, 244], // #4285F4
  irisAlert: [234, 67, 53], // #EA4335
  pupil: "#202124",
  glow: "234,67,53",
  ring: ["#4285F4", "#EA4335", "#FBBC05", "#34A853"],
};

/** Amazon's ink-blue and orange; the accent arc is the warm under-eye curve. */
const AMAZON: SkinPalette = {
  id: "amazon",
  label: "Amazon",
  sclera: "#fdfdfb",
  lid: "rgba(35,47,62,0.9)", // #232F3E
  irisCalm: [20, 110, 180], // #146EB4
  irisAlert: [255, 153, 0], // #FF9900
  pupil: "#232F3E",
  glow: "255,153,0",
  accent: "#FF9900",
};

export const SKINS: Record<Exclude<EyeSkin, "auto">, SkinPalette> = {
  neutral: NEUTRAL,
  google: GOOGLE,
  amazon: AMAZON,
};

/** Tracker organisations that have a skin of their own. */
const ORGANIZATION_SKINS: Record<string, Exclude<EyeSkin, "auto">> = {
  Google: "google",
  Amazon: "amazon",
};

/**
 * Resolve the configured skin. In "auto" mode the eye takes the colours of the
 * organisation with the heaviest tracking presence on the current page, and
 * falls back to neutral when nobody recognisable is watching.
 */
export function resolveSkin(skin: EyeSkin, dominantOrganization: string | null): SkinPalette {
  if (skin !== "auto") return SKINS[skin];
  const auto = dominantOrganization ? ORGANIZATION_SKINS[dominantOrganization] : undefined;
  return SKINS[auto ?? "neutral"];
}
