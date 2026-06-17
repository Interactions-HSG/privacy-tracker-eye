// Animated eye renderer (Deliverable 5).
// -----------------------------------------------------------------------------
// A self-contained Canvas-2D eye with a small behavioural state machine: gaze
// (wander vs. cursor-pursuit vs. forward stare), blinking, lid openness, pupil
// dilation and alert micro-motion. All of it is driven by a single continuous
// intensity value via behaviorFor(). The class knows nothing about trackers; it
// just receives setIntensity()/setCursor() and animates.

import { behaviorFor, clamp01, lerp, type BehaviorParams } from "./behavior";

interface Vec {
  x: number;
  y: number;
}

/** Frame-rate-independent easing factor for a per-16.7ms alpha. */
function easeAlpha(alphaPer60fps: number, dtMs: number): number {
  return 1 - Math.pow(1 - alphaPer60fps, dtMs / 16.6667);
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

  // Micro-motion phase.
  private phase = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
    /** Unit vector pointing "off-screen" for the anchored corner. */
    private driftDir: Vec,
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

  setDriftDirection(dir: Vec): void {
    this.driftDir = dir;
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
    const b = behaviorFor(this.displayIntensity);

    this.phase += dt * 0.004;
    this.updateGaze(dt, now, b);
    this.updateBlink(dt, b);
    this.applyHostTransform(b);
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

    // Attend target: follow cursor if it moved recently, else stare forward.
    const cursorActive = now - this.lastCursorMove < 1500;
    let attend: Vec = { x: 0, y: 0 }; // forward / direct gaze
    if (cursorActive && this.cursor) {
      const rect = this.canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
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

  private applyHostTransform(b: BehaviorParams): void {
    // Drift partially off-screen at low intensity; come forward at high.
    // Use the CSS (layout) width so drift is in CSS px even on HiDPI displays,
    // where the canvas backing store is larger than its on-screen size.
    const size = this.canvas.clientWidth || this.canvas.width;
    const driftPx = b.screenDrift * size * 0.5;
    const micro = b.microMotion;
    const jx = Math.sin(this.phase * 5.0) * micro;
    const jy = Math.cos(this.phase * 6.3) * micro;
    const tx = this.driftDir.x * driftPx + jx;
    const ty = this.driftDir.y * driftPx + jy;
    this.host.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
  }

  // --- rendering -------------------------------------------------------------
  private render(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const b = behaviorFor(this.displayIntensity);
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
    ctx.fillStyle = "#fbfdff";
    ctx.fill(path);
    ctx.restore();

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
    ctx.strokeStyle = "rgba(20,24,33,0.85)";
    ctx.stroke(path);
  }

  private drawIris(
    ctx: CanvasRenderingContext2D,
    ix: number,
    iy: number,
    irisR: number,
    b: BehaviorParams,
  ): void {
    // Calm steel-blue -> intense amber as intensity rises.
    const calm = [58, 120, 208];
    const intense = [214, 119, 47];
    const col = (i: number) => Math.round(lerp(calm[i], intense[i], b.irisIntensity));
    const c = `rgb(${col(0)},${col(1)},${col(2)})`;

    const grad = ctx.createRadialGradient(ix, iy, irisR * 0.1, ix, iy, irisR);
    grad.addColorStop(0, lighten(c, 0.35));
    grad.addColorStop(0.6, c);
    grad.addColorStop(1, darken(c, 0.45));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ix, iy, irisR, 0, Math.PI * 2);
    ctx.fill();

    // Faint glow ring when intense.
    if (b.irisIntensity > 0.5) {
      ctx.lineWidth = irisR * 0.08;
      ctx.strokeStyle = `rgba(255,140,70,${(b.irisIntensity - 0.5) * 0.6})`;
      ctx.beginPath();
      ctx.arc(ix, iy, irisR * 0.96, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Pupil.
    const pupilR = irisR * b.pupilDilation;
    ctx.fillStyle = "#08090c";
    ctx.beginPath();
    ctx.arc(ix, iy, pupilR, 0, Math.PI * 2);
    ctx.fill();

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
function parseRgb(c: string): [number, number, number] {
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
