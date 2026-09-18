// Behaviour model: continuous tracking intensity -> eye animation parameters.
// -----------------------------------------------------------------------------
// This is the heart of the "anthropomorphic" mapping. Every parameter varies
// CONTINUOUSLY with intensity I in [0,1]; the discrete Low/Medium/High labels in
// the brief are just regions of this continuum. The verbal targets:
//
//   Low (relaxed, disinterested): looks away, wanders, may drift partly
//     off-screen, heavy/sleepy lids, slow frequent blinks, small pupil, mostly
//     ignores the cursor.
//   Medium (attentive): occasional glances toward the user, mild cursor
//     pursuit, lids open, pupil neutral.
//   High (intensely interested): locks a direct forward gaze, aggressive cursor
//     pursuit, wide lids, rare blinks, dilated pupil, comes forward (no drift),
//     subtle alert micro-motion.
//
// On top of that continuum sits ONE discrete state — close inspection — for the
// moment the participant is actually disclosing something (see fields.ts). There
// the eye stops caring about the cursor and reads the field: lids at maximum,
// pupil wide, blinking almost suppressed, gaze pinned to the caret. How extreme
// it gets scales with the *sensitivity* of the field (a hobby checkbox barely
// registers; a date of birth gets a stare).

export interface BehaviorParams {
  /** 0 = ignore cursor/user and wander, 1 = fully target cursor/user. */
  attention: number;
  /** Iris displacement gain toward the gaze target (fraction of travel). */
  pursuitGain: number;
  /** Per-frame smoothing toward the gaze target (higher = snappier lock). */
  pursuitSmoothing: number;
  /** Mean ms between blinks (larger = blinks less often). */
  blinkIntervalMs: number;
  /** Duration of a single blink in ms (larger = slower, heavier blink). */
  blinkDurationMs: number;
  /** Baseline eyelid openness 0..1 (smaller = sleepier/heavier lids). */
  lidOpenness: number;
  /** Pupil radius as a fraction of iris radius. */
  pupilDilation: number;
  /** Mean ms between wandering saccades when not attending. */
  saccadeIntervalMs: number;
  /** How far gaze wanders; >1 lets the gaze leave the eye toward the edge. */
  wanderAmplitude: number;
  /** Fraction of the eye that slips past the screen edge (0 = fully on-screen). */
  screenDrift: number;
  /** Amplitude (px) of alert micro-motion at high intensity. */
  microMotion: number;
  /** 0 = calm blue iris, 1 = intense/warm iris. */
  irisIntensity: number;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Map a continuous intensity in [0,1] to a full set of behaviour parameters. */
export function behaviorFor(intensity: number): BehaviorParams {
  const I = clamp01(intensity);
  // Attention ramps in a little above zero so an idle page is clearly relaxed.
  const attention = smoothstep((I - 0.05) / 0.95);

  return {
    attention,
    pursuitGain: lerp(0.12, 1.0, I),
    pursuitSmoothing: lerp(0.05, 0.24, I),
    blinkIntervalMs: lerp(3200, 12000, I),
    blinkDurationMs: lerp(430, 150, I),
    lidOpenness: lerp(0.5, 1.0, smoothstep(I)),
    pupilDilation: lerp(0.42, 0.82, I),
    saccadeIntervalMs: lerp(850, 4200, I),
    wanderAmplitude: lerp(1.35, 0.25, I),
    screenDrift: lerp(0.42, 0.0, smoothstep(I)),
    microMotion: lerp(0, 0.7, smoothstep((I - 0.5) / 0.5)),
    irisIntensity: I,
  };
}

/**
 * Behaviour while the eye is reading a form field from close up.
 *
 * @param sensitivity how revealing the field is, in [0,1] (see fields.ts)
 * @param intensity   the page's measured tracking intensity, so a heavily
 *                    tracked page still inspects harder than a quiet one
 */
export function inspectionBehaviorFor(sensitivity: number, intensity: number): BehaviorParams {
  const s = clamp01(sensitivity);
  // Inspecting always implies a floor of arousal, raised further by sensitivity.
  const I = Math.max(clamp01(intensity), lerp(0.5, 0.95, s));
  return {
    ...behaviorFor(I),
    attention: 1, // the cursor is irrelevant now; the field is everything
    pursuitGain: 1.15, // slight over-gain so the iris pins to the caret
    pursuitSmoothing: lerp(0.16, 0.3, s),
    blinkIntervalMs: lerp(9000, 20000, s), // it does not want to miss a keystroke
    blinkDurationMs: 130,
    lidOpenness: 1,
    pupilDilation: lerp(0.68, 0.92, s),
    saccadeIntervalMs: 5000,
    wanderAmplitude: 0.12,
    screenDrift: 0, // never off-screen while inspecting
    microMotion: lerp(0.25, 0.9, s),
    irisIntensity: I,
  };
}

/** Linear blend of two behaviour parameter sets (t = 0 -> a, 1 -> b). */
export function blendBehavior(a: BehaviorParams, b: BehaviorParams, t: number): BehaviorParams {
  const k = clamp01(t);
  const mix = (key: keyof BehaviorParams) => lerp(a[key], b[key], k);
  return {
    attention: mix("attention"),
    pursuitGain: mix("pursuitGain"),
    pursuitSmoothing: mix("pursuitSmoothing"),
    blinkIntervalMs: mix("blinkIntervalMs"),
    blinkDurationMs: mix("blinkDurationMs"),
    lidOpenness: mix("lidOpenness"),
    pupilDilation: mix("pupilDilation"),
    saccadeIntervalMs: mix("saccadeIntervalMs"),
    wanderAmplitude: mix("wanderAmplitude"),
    screenDrift: mix("screenDrift"),
    microMotion: mix("microMotion"),
    irisIntensity: mix("irisIntensity"),
  };
}
