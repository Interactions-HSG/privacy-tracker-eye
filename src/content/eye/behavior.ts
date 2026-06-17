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
