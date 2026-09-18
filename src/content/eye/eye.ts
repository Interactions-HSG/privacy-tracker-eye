// Animated eye renderer (Deliverable 5).
// -----------------------------------------------------------------------------
// A self-contained Canvas-2D eye with a small behavioural state machine: gaze
// (wander vs. cursor-pursuit vs. forward stare vs. CLOSE INSPECTION of a form
// field), blinking, lid openness, pupil dilation, alert micro-motion, and where
// on screen the eye places itself. All of it is driven by a single continuous
// intensity value via behaviorFor(), plus an optional inspection target.
//
// The class knows nothing about trackers or forms; it receives setIntensity(),
// setCursor(), setSkin() and inspect(), and animates.

import {
  behaviorFor,
  blendBehavior,
  clamp01,
  inspectionBehaviorFor,
  lerp,
  type BehaviorParams,
} from "./behavior";
import { SKINS, type Rgb, type SkinPalette } from "./skins";
import type { Config } from "../../shared/types";

interface Vec {
  x: number;
  y: number;
}

/** Where the eye lives when it is not inspecting anything. */
export interface EyeLayout {
  corner: Config["corner"];
  /** Distance from the screen edges, in CSS px. */
  margin: number;
  /** CSS size of the canvas box. */
  width: number;
  height: number;
}

/** Live geometry of the field being inspected, in client coordinates. */
export interface InspectionGeometry {
  rect: { left: number; top: number; width: number; height: number };
  /** The point being read (caret / centre of the control). */
  point: Vec;
  /** performance.now() of the last keystroke, for the re-reading sweep. */
  lastInput: number;
}

export interface InspectionTarget {
  /** How revealing the field is, in [0,1]. */
  sensitivity: number;
  /** Re-read each frame; null when the field is gone or scrolled away. */
  read: () => InspectionGeometry | null;
}

/** Frame-rate-independent easing factor for a per-16.7ms alpha. */
function easeAlpha(alphaPer60fps: number, dtMs: number): number {
  return 1 - Math.pow(1 - alphaPer60fps, dtMs / 16.6667);
}

/**
 * Layout viewport in CSS px. documentElement.clientWidth excludes the
 * scrollbar, which is what a position:fixed box is laid out against.
 */
function viewport(): { w: number; h: number } {
  const el = document.documentElement;
  return {
    w: el?.clientWidth || window.innerWidth,
    h: el?.clientHeight || window.innerHeight,
  };
}

/** Unit vector pointing "off the screen" for each corner (for the drift). */
function driftDirectionFor(corner: Config["corner"]): Vec {
  return {
    x: corner.endsWith("left") ? -1 : 1,
    y: corner.startsWith("top") ? -1 : 1,
  };
}

export class Eye {
  private readonly ctx: CanvasRenderingContext2D;
  private raf = 0;
  private lastT = 0;
  private running = false;

  // Intensity (target vs. smoothly displayed).
  private targetIntensity = 0;
  private displayIntensity = 0;

  // Gaze in normalised eye space [-1,1]^2 (0,0 = forward / direct gaze).
  private gaze: Vec = { x: 0, y: 0 };
  private wanderTarget: Vec = { x: 0, y: 0 };
  private saccadeTimer = 0;

  // Eyelid.
  private openness = 0.6;
  private blinkTimer = 1500;
  private blinking = false;
  private blinkElapsed = 0;
  private blinkDuration = 300;

  // Cursor (client coords) and the moment it last moved.
  private cursor: Vec | null = null;
  private lastCursorMove = -Infinity;

  // Close inspection of a form field.
  private inspection: InspectionTarget | null = null;
  private geom: InspectionGeometry | null = null;
  private inspectBlend = 0;
  private lastSensitivity = 0.5;

  // Placement of the eye box (top-left, client coords) and its scale.
  private pos: Vec | null = null;
  private scale = 1;

  // Micro-motion phase.
  private phase = 0;

  /** Behaviour of the current frame, shared between update() and render(). */
  private behavior: BehaviorParams = behaviorFor(0);

  private skin: SkinPalette = SKINS.neutral;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
    private layout: EyeLayout,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  setIntensity(value: number): void {
    this.targetIntensity = clamp01(value);
  }

  setCursor(clientX: number, clientY: number): void {
    this.cursor = { x: clientX, y: clientY };
    this.lastCursorMove = performance.now();
  }

  setSkin(skin: SkinPalette): void {
    this.skin = skin;
  }

  setLayout(layout: EyeLayout): void {
    this.layout = layout;
  }

  /** Start (target) or end (null) a close inspection of a form field. */
  inspect(target: InspectionTarget | null): void {
    this.inspection = target;
    if (target) this.lastSensitivity = target.sensitivity;
    else this.geom = null;
  }

  /** True while the eye is at a field rather than in its corner. */
  get isInspecting(): boolean {
    return this.geom !== null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const tick = (t: number) => {
      if (!this.running) return;
      const dt = Math.min(64, t - this.lastT);
      this.lastT = t;
      this.update(dt, t);
      this.render();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // --- behaviour update ------------------------------------------------------
  private update(dt: number, now: number): void {
    // Smoothly approach the target intensity so the eye never snaps.
    this.displayIntensity = lerp(
      this.displayIntensity,
      this.targetIntensity,
      easeAlpha(0.05, dt),
    );

    // Re-read the inspected field every frame so the eye tracks it through
    // scrolling, resizing and layout shifts; a null read ends the inspection.
    this.geom = this.inspection ? this.inspection.read() : null;
    this.inspectBlend = lerp(this.inspectBlend, this.geom ? 1 : 0, easeAlpha(0.1, dt));

    const base = behaviorFor(this.displayIntensity);
    const b =
      this.inspectBlend > 0.002
        ? blendBehavior(
            base,
            inspectionBehaviorFor(this.lastSensitivity, this.displayIntensity),
            this.inspectBlend,
          )
        : base;

    this.phase += dt * 0.004;
    this.updateGaze(dt, now, b);
    this.updateBlink(dt, b);
    this.applyHostTransform(dt, b);
    this.behavior = b;
  }

  private updateGaze(dt: number, now: number, b: BehaviorParams): void {
    // Wander: pick a new random target on a cadence; amplitude can exceed 1 so
    // the gaze can slide toward/under the lid ("looking away").
    this.saccadeTimer -= dt;
    if (this.saccadeTimer <= 0) {
      const amp = b.wanderAmplitude;
      this.wanderTarget = {
        x: (Math.random() * 2 - 1) * amp,
        y: (Math.random() * 2 - 1) * amp * 0.7,
      };
      this.saccadeTimer = b.saccadeIntervalMs * (0.6 + Math.random() * 0.8);
    }

    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Attend target, in order of precedence: the field being inspected, then a
    // recently moved cursor, else a forward stare.
    let attend: Vec = { x: 0, y: 0 };
    if (this.geom) {
      // Close up, the reference distance is the field itself: that way the
      // iris sweeps the whole input as the caret moves, instead of pinning at
      // full deflection for everything but the last few characters.
      const p = this.readingPoint(now, this.geom);
      const ref = Math.max(180, this.geom.rect.width * 0.9 + rect.width * 0.6);
      attend = {
        x: clampRange(((p.x - cx) / ref) * b.pursuitGain, -1, 1),
        y: clampRange(((p.y - cy) / ref) * b.pursuitGain, -1, 1),
      };
    } else if (this.cursor && now - this.lastCursorMove < 1500) {
      const ref = Math.max(window.innerWidth, window.innerHeight) * 0.5;
      attend = {
        x: clampRange(((this.cursor.x - cx) / ref) * b.pursuitGain, -1, 1),
        y: clampRange(((this.cursor.y - cy) / ref) * b.pursuitGain, -1, 1),
      };
    }

    const target = {
      x: lerp(this.wanderTarget.x, attend.x, b.attention),
      y: lerp(this.wanderTarget.y, attend.y, b.attention),
    };

    const a = easeAlpha(b.pursuitSmoothing, dt);
    this.gaze.x = lerp(this.gaze.x, target.x, a);
    this.gaze.y = lerp(this.gaze.y, target.y, a);
  }

  /**
   * Where the eye is looking inside the field. While the participant types it
   * is the caret; once they pause, the gaze sweeps back over what is already
   * there — the "let me read that again" pass that makes the look thorough.
   */
  private readingPoint(now: number, g: InspectionGeometry): Vec {
    const idle = now - g.lastInput;
    if (idle < 650) return g.point;
    const startX = g.rect.left + Math.min(12, g.rect.width * 0.08);
    const endX = Math.max(startX + 4, g.point.x);
    const t = (Math.sin((idle - 650) / 420) + 1) / 2;
    return { x: lerp(startX, endX, t), y: g.point.y };
  }

  private updateBlink(dt: number, b: BehaviorParams): void {
    if (this.blinking) {
      this.blinkElapsed += dt;
      const p = clamp01(this.blinkElapsed / this.blinkDuration);
      // 1 -> 0 -> 1 close/open curve.
      const closeFactor = 1 - Math.sin(p * Math.PI);
      this.openness = lerp(
        this.openness,
        b.lidOpenness * closeFactor,
        easeAlpha(0.6, dt),
      );
      if (p >= 1) {
        this.blinking = false;
        this.blinkTimer = b.blinkIntervalMs * (0.6 + Math.random() * 0.8);
      }
    } else {
      // Settle toward baseline openness for the current intensity.
      this.openness = lerp(this.openness, b.lidOpenness, easeAlpha(0.12, dt));
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blinking = true;
        this.blinkElapsed = 0;
        this.blinkDuration = b.blinkDurationMs;
      }
    }
  }

  // --- placement -------------------------------------------------------------
  /** Where the eye box wants to be right now (client coords + scale). */
  private targetPlacement(b: BehaviorParams): { pos: Vec; scale: number } {
    if (this.geom) return this.inspectionPlacement(this.geom);

    const { corner, margin, width, height } = this.layout;
    const drift = driftDirectionFor(corner);
    const { w: vw, h: vh } = viewport();
    const x = corner.endsWith("left") ? margin : vw - margin - width;
    const y = corner.startsWith("top") ? margin : vh - margin - height;
    // Drift partially off-screen at low intensity; come forward at high.
    const driftPx = b.screenDrift * width * 0.5;
    return { pos: { x: x + drift.x * driftPx, y: y + drift.y * driftPx }, scale: 1 };
  }

  /**
   * Park the eye next to the field it is reading: to its right if there is
   * room, otherwise left, otherwise above/below. It shrinks while inspecting so
   * it can sit beside an input without covering the page.
   */
  private inspectionPlacement(g: InspectionGeometry): { pos: Vec; scale: number } {
    const { width, height } = this.layout;
    const scale = clampRange(clampRange(width * 0.55, 130, 260) / width, 0.3, 1);
    const w = width * scale;
    const h = height * scale;
    const gap = Math.max(10, h * 0.14);
    const { w: vw, h: vh } = viewport();
    const right = g.rect.left + g.rect.width;

    let x = right + gap;
    let y = g.rect.top + g.rect.height / 2 - h / 2;

    if (x + w > vw - 6) {
      const leftSide = g.rect.left - gap - w;
      if (leftSide >= 6) {
        x = leftSide;
      } else {
        // No room either side: stack the eye over (or under) the field.
        x = clampRange(g.rect.left + g.rect.width / 2 - w / 2, 6, Math.max(6, vw - w - 6));
        const above = g.rect.top - gap - h;
        y = above >= 6 ? above : g.rect.top + g.rect.height + gap;
      }
    }

    return {
      pos: {
        x: clampRange(x, 6, Math.max(6, vw - w - 6)),
        y: clampRange(y, 6, Math.max(6, vh - h - 6)),
      },
      scale,
    };
  }

  private applyHostTransform(dt: number, b: BehaviorParams): void {
    const target = this.targetPlacement(b);
    if (!this.pos) {
      this.pos = { ...target.pos };
      this.scale = target.scale;
    }
    // One easing rate for the whole journey: the flight to a field and the
    // drift in the corner are the same motion, so the eye never teleports.
    const a = easeAlpha(0.11, dt);
    this.pos.x = lerp(this.pos.x, target.pos.x, a);
    this.pos.y = lerp(this.pos.y, target.pos.y, a);
    this.scale = lerp(this.scale, target.scale, a);

    const micro = b.microMotion;
    const jx = Math.sin(this.phase * 5.0) * micro;
    const jy = Math.cos(this.phase * 6.3) * micro;
    this.host.style.transform =
      `translate(${(this.pos.x + jx).toFixed(1)}px, ${(this.pos.y + jy).toFixed(1)}px) ` +
      `scale(${this.scale.toFixed(3)})`;
  }

  // --- rendering -------------------------------------------------------------
  private render(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const b = this.behavior;
    const skin = this.skin;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const eyeHalfW = W * 0.45;
    const maxOpenH = H * 0.42; // slightly taller opening => a bit rounder
    const openH = maxOpenH * clamp01(this.openness);

    // Eye-opening almond path (reused as a clip and as the sclera fill).
    const path = new Path2D();
    path.moveTo(cx - eyeHalfW, cy);
    path.quadraticCurveTo(cx, cy - openH, cx + eyeHalfW, cy);
    path.quadraticCurveTo(cx, cy + openH, cx - eyeHalfW, cy);
    path.closePath();

    // Soft drop shadow / socket.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = W * 0.06;
    ctx.shadowOffsetY = H * 0.02;
    ctx.fillStyle = skin.sclera;
    ctx.fill(path);
    ctx.restore();

    if (skin.accent) this.drawAccent(ctx, cx, cy, eyeHalfW, maxOpenH, skin.accent, b);

    if (openH < 1.5) return; // essentially closed; skip iris.

    // Clip to the eye opening for everything inside.
    ctx.save();
    ctx.clip(path);

    // Iris geometry follows the gaze, clamped to stay within the sclera.
    const irisR = H * 0.32;
    const maxGX = eyeHalfW - irisR * 0.75;
    const maxGY = maxOpenH - irisR * 0.55;
    const ix = cx + clampRange(this.gaze.x, -1, 1) * maxGX;
    const iy = cy + clampRange(this.gaze.y, -1, 1) * Math.max(0, maxGY);

    this.drawIris(ctx, ix, iy, irisR, b);

    // Bloodshot veins / alert flush at high intensity.
    if (b.irisIntensity > 0.55) {
      this.drawVeins(ctx, cx, cy, eyeHalfW, openH, b.irisIntensity);
    }

    // Subtle lid shading from the top for depth.
    const grad = ctx.createLinearGradient(0, cy - maxOpenH, 0, cy);
    grad.addColorStop(0, "rgba(0,0,0,0.18)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, cy - maxOpenH, W, maxOpenH);
    ctx.restore();

    // Eyelid outline on top of the clip.
    ctx.lineWidth = Math.max(1.5, W * 0.012);
    ctx.strokeStyle = skin.lid;
    ctx.stroke(path);
  }

  private drawIris(
    ctx: CanvasRenderingContext2D,
    ix: number,
    iy: number,
    irisR: number,
    b: BehaviorParams,
  ): void {
    const skin = this.skin;
    const mix = (i: number) =>
      Math.round(lerp(skin.irisCalm[i] as number, skin.irisAlert[i] as number, b.irisIntensity));
    const c = `rgb(${mix(0)},${mix(1)},${mix(2)})`;

    const grad = ctx.createRadialGradient(ix, iy, irisR * 0.1, ix, iy, irisR);
    grad.addColorStop(0, lighten(c, 0.35));
    grad.addColorStop(0.6, c);
    grad.addColorStop(1, darken(c, 0.45));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ix, iy, irisR, 0, Math.PI * 2);
    ctx.fill();

    // Pupil.
    const pupilR = irisR * b.pupilDilation;
    ctx.fillStyle = skin.pupil;
    ctx.beginPath();
    ctx.arc(ix, iy, pupilR, 0, Math.PI * 2);
    ctx.fill();

    // Branded rim: the owner's colours as segments around the iris, turning
    // slowly so the eye reads as "alive" rather than as a logo. Drawn over the
    // pupil, which swells past the rim when the eye is staring hardest.
    if (skin.ring) this.drawRing(ctx, ix, iy, irisR, skin.ring, b);

    // Faint glow ring when intense.
    if (b.irisIntensity > 0.5) {
      ctx.lineWidth = irisR * 0.08;
      ctx.strokeStyle = `rgba(${skin.glow},${(b.irisIntensity - 0.5) * 0.6})`;
      ctx.beginPath();
      ctx.arc(ix, iy, irisR * 0.96, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Specular highlights (the "alive" look).
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.arc(ix - irisR * 0.35, iy - irisR * 0.4, irisR * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(ix + irisR * 0.18, iy + irisR * 0.25, irisR * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawRing(
    ctx: CanvasRenderingContext2D,
    ix: number,
    iy: number,
    irisR: number,
    colors: readonly string[],
    b: BehaviorParams,
  ): void {
    const step = (Math.PI * 2) / colors.length;
    const spin = this.phase * lerp(0.15, 0.6, b.irisIntensity);
    ctx.lineWidth = irisR * 0.16;
    ctx.lineCap = "butt";
    for (let i = 0; i < colors.length; i++) {
      ctx.strokeStyle = colors[i] as string;
      ctx.beginPath();
      ctx.arc(ix, iy, irisR * 0.9, spin + i * step + 0.04, spin + (i + 1) * step - 0.04);
      ctx.stroke();
    }
  }

  /** Warm curve under the eye — a skin ornament, not a logotype. */
  private drawAccent(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    eyeHalfW: number,
    maxOpenH: number,
    color: string,
    b: BehaviorParams,
  ): void {
    // Kept inside the canvas box: the curve's lowest point sits at roughly
    // 0.93 of the canvas height, just clear of the bottom edge.
    const y = cy + maxOpenH * 0.72;
    const span = eyeHalfW * 0.82;
    ctx.save();
    ctx.globalAlpha = lerp(0.45, 1, b.irisIntensity);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, eyeHalfW * 0.055);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - span, y);
    ctx.quadraticCurveTo(cx, y + maxOpenH * 0.62, cx + span, y);
    ctx.stroke();
    ctx.restore();
  }

  private drawVeins(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    eyeHalfW: number,
    openH: number,
    intensity: number,
  ): void {
    ctx.strokeStyle = `rgba(200,40,40,${(intensity - 0.55) * 0.5})`;
    ctx.lineWidth = Math.max(0.6, openH * 0.02);
    for (const side of [-1, 1]) {
      const x0 = cx + side * eyeHalfW * 0.9;
      ctx.beginPath();
      ctx.moveTo(x0, cy);
      ctx.quadraticCurveTo(x0 - side * eyeHalfW * 0.25, cy - openH * 0.3, cx + side * eyeHalfW * 0.45, cy - openH * 0.15);
      ctx.moveTo(x0, cy);
      ctx.quadraticCurveTo(x0 - side * eyeHalfW * 0.2, cy + openH * 0.3, cx + side * eyeHalfW * 0.5, cy + openH * 0.2);
      ctx.stroke();
    }
  }
}

// --- small colour helpers ----------------------------------------------------
function clampRange(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
function parseRgb(c: string): Rgb {
  const m = c.match(/rgb\((\d+),(\d+),(\d+)\)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function lighten(c: string, amt: number): string {
  const [r, g, b] = parseRgb(c);
  return `rgb(${Math.round(lerp(r, 255, amt))},${Math.round(lerp(g, 255, amt))},${Math.round(lerp(b, 255, amt))})`;
}
function darken(c: string, amt: number): string {
  const [r, g, b] = parseRgb(c);
  return `rgb(${Math.round(lerp(r, 0, amt))},${Math.round(lerp(g, 0, amt))},${Math.round(lerp(b, 0, amt))})`;
}
