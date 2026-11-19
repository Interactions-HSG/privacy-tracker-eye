// Data miners — the trackers' little workers.
// -----------------------------------------------------------------------------
// The eye shows that somebody is *watching*; the miners show that something is
// being *taken*. When the participant types into a field on a tracked page,
// small workers scurry in from the edge of the window, hack at the field with a
// pickaxe, toss what they chip off into the wooden basket on their back, and
// run out of the window again with it. They always come as a squad, and they
// are not very good at leaving: a little hop, then a clumsy, stumbling dash
// that spills the odd chip. Each one wears the shirt of a tracker
// organisation that is actually present on the page.
//
// PRIVACY INVARIANT: the chips are generic blocks. This module only ever sees
// the field's geometry and a character *count* — never what was typed.
//
// Like the eye, the crew lives in its own click-through Shadow DOM host, so it
// can neither be styled by the page nor intercept anything on it.

import type { InspectionGeometry, InspectionTarget } from "../eye/eye";
import { shirtFor, type Shirt } from "./shirts";

const ROOT_ID = "tracker-eye-miners";

/** Drawing box of one miner, in CSS px. Feet stand at (FOOT_X, FOOT_Y). */
const BOX_W = 76;
const BOX_H = 62;
const FOOT_X = 34;
const FOOT_Y = 56;

const ENTER_SPEED = 290; // px / s — a trot, shoulder to shoulder
const LEAVE_SPEED = 310; // px / s, before the stumbling
const SWINGS_PER_LOAD = 3;
const SWING_MS = 360;
const CHARS_PER_LOAD = 4;
const MAX_LOADS_PER_FIELD = 8;
/** They never come alone … */
const MIN_SQUAD = 2;
/** … and never more than this at once. */
const MAX_SQUAD = 4;
/** Distance between squad members as they file in, in px. */
const SQUAD_SPACING = 30;
/** Typing is watched for this long before the first squad sets off. */
const MUSTER_MS = 600;
const JUMP_MS = 440;
const TRIP_MS = 430;

/**
 * enter → mine → wait (for the rest of the squad) → jump (most of them, as
 * they turn to go) → leave.
 */
type Phase = "enter" | "mine" | "wait" | "jump" | "leave";

interface Chip {
  /** 0 → 1 along the arc from the pick to the basket. */
  t: number;
}

interface Miner {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  shirt: Shirt;
  /** The field this miner was sent to, and where it last was. */
  target: InspectionTarget;
  rect: InspectionGeometry["rect"];
  phase: Phase;
  /** Miners that came in together share a squad number and leave together. */
  squad: number;
  /** Client x of the feet. */
  x: number;
  /** -1 = came from (and leaves to) the left edge, 1 = the right. */
  side: -1 | 1;
  /** Fraction along the field width where this miner works. */
  slot: number;
  facing: -1 | 1;
  stride: number;
  mineElapsed: number;
  swingsDone: number;
  load: number;
  chips: Chip[];
  /** Chips that bounced out of the basket during a stumble. */
  spills: Chip[];
  /** Time spent waiting for the squad, and how long this one dawdles after. */
  waited: number;
  dawdle: number;
  jumps: boolean;
  /** Progress of the hop (0..1). */
  jumpT: number;
  /** Progress of the current stumble (0..1), or -1 when on its feet. */
  tripT: number;
  /** Time until the next stumble, in ms. */
  nextTrip: number;
  /** Individual running pace on the way out. */
  pace: number;
  /** Pose handed to draw(): forward pitch (rad), lift off the ground (px), leg tuck (0..1). */
  lean: number;
  hop: number;
  tuck: number;
}

/** The field currently being mined and how much of it has been hauled off. */
interface Job {
  target: InspectionTarget;
  /** lastInput at first sight — it changes once the participant really types. */
  initialInput: number | null;
  /** How long the participant has been typing here, in ms. */
  typedFor: number;
  dispatched: number;
}

export class MinerCrew {
  private root: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  private miners: Miner[] = [];
  private job: Job | null = null;
  private organizations: string[] = [];
  private nextShirt = 0;
  private nextSide: -1 | 1 = -1;
  private nextSquad = 0;
  private raf = 0;
  private lastT = 0;

  /** Whose shirts the crew wears — the tracker organisations on this page. */
  setOrganizations(organizations: readonly string[]): void {
    this.organizations = [...organizations];
  }

  /** Point the crew at a field (or call with null to call them off). */
  inspect(target: InspectionTarget | null): void {
    this.job = target ? { target, initialInput: null, typedFor: 0, dispatched: 0 } : null;
    if (target) this.ensureRunning();
  }

  /** Remove everything immediately (feature switched off). */
  destroy(): void {
    this.job = null;
    this.miners = [];
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.root?.remove();
    this.root = null;
    this.layer = null;
  }

  // --- loop ------------------------------------------------------------------
  private ensureRunning(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(64, t - this.lastT);
      this.lastT = t;
      this.update(dt);
      // Idle (nothing to mine, nobody on screen) => stop animating entirely.
      this.raf = this.job || this.miners.length > 0 ? requestAnimationFrame(tick) : 0;
    };
    this.raf = requestAnimationFrame(tick);
  }

  private update(dt: number): void {
    const job = this.job;
    const geom = job ? job.target.read() : null;
    if (job && geom) this.dispatch(job, geom, dt);

    const vw = document.documentElement?.clientWidth || window.innerWidth;
    // A squad leaves together: nobody goes while a mate is still on the job.
    const busySquads = new Set(
      this.miners.filter((m) => m.phase === "enter" || m.phase === "mine").map((m) => m.squad),
    );
    for (const m of this.miners) {
      // A miner follows its own field while that field is still the one being
      // filled in; afterwards it finishes up where the field last was.
      const present = geom !== null && job?.target === m.target;
      if (present) m.rect = geom.rect;
      this.step(m, dt, m.rect, vw, present, !busySquads.has(m.squad));
    }
    this.miners = this.miners.filter((m) => {
      const gone = m.phase === "leave" && (m.x < -BOX_W || m.x > vw + BOX_W);
      if (gone) m.canvas.remove();
      return !gone;
    });
    for (const m of this.miners) {
      // Stand on the field's top edge; if there is no headroom, on its bottom edge.
      const groundY = m.rect.top >= BOX_H ? m.rect.top + 3 : m.rect.top + m.rect.height + 2;
      m.canvas.style.transform = `translate(${(m.x - (m.facing === 1 ? FOOT_X : BOX_W - FOOT_X)).toFixed(1)}px, ${(groundY - FOOT_Y + m.hop).toFixed(1)}px)`;
      draw(m);
    }
  }

  /** Send in the next squad if there is still unmined data in the field. */
  private dispatch(job: Job, geom: InspectionGeometry, dt: number): void {
    if (job.initialInput === null) job.initialInput = geom.lastInput;
    const typed = geom.lastInput !== job.initialInput;
    if (!typed || geom.chars <= 0) return;

    // Let a few keystrokes accumulate, so the squad's size fits the entry.
    job.typedFor += dt;
    if (job.typedFor < MUSTER_MS) return;

    const wanted = Math.min(MAX_LOADS_PER_FIELD, Math.ceil(geom.chars / CHARS_PER_LOAD));
    if (job.dispatched >= wanted) return;
    // One squad at a time: the next waits until the last is on its way out.
    if (this.miners.some((m) => m.phase !== "leave")) return;

    const size = clamp(wanted - job.dispatched, MIN_SQUAD, MAX_SQUAD);
    this.spawnSquad(job, geom, size);
    job.dispatched += size;
  }

  /** A squad files in from one edge of the window, front runner first. */
  private spawnSquad(job: Job, geom: InspectionGeometry, size: number): void {
    const layer = this.ensureLayer();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const vw = document.documentElement?.clientWidth || window.innerWidth;
    const side = this.nextSide;
    this.nextSide = side === 1 ? -1 : 1;
    const squad = this.nextSquad++;

    for (let i = 0; i < size; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(BOX_W * dpr);
      canvas.height = Math.round(BOX_H * dpr);
      Object.assign(canvas.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: `${BOX_W}px`,
        height: `${BOX_H}px`,
        pointerEvents: "none",
        willChange: "transform",
      });
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.scale(dpr, dpr);
      layer.appendChild(canvas);

      const org = this.organizations.length
        ? (this.organizations[this.nextShirt++ % this.organizations.length] as string)
        : null;
      // Later members start further outside the window, so they arrive in file.
      const behind = BOX_W * 0.6 + i * SQUAD_SPACING + Math.random() * 8;
      // The front runner takes the far end of the field, so nobody has to
      // squeeze past a mate who is already swinging a pickaxe.
      const place = side === -1 ? size - 1 - i : i;

      this.miners.push({
        canvas,
        ctx,
        shirt: shirtFor(org),
        target: job.target,
        rect: geom.rect,
        phase: "enter",
        squad,
        x: side === -1 ? -behind : vw + behind,
        side,
        slot: (place + 1) / (size + 1),
        facing: side === -1 ? 1 : -1,
        stride: Math.random() * 6,
        mineElapsed: 0,
        swingsDone: 0,
        load: 0,
        chips: [],
        spills: [],
        waited: 0,
        dawdle: 80 + Math.random() * 260,
        jumps: Math.random() < 0.7,
        jumpT: 0,
        tripT: -1,
        nextTrip: 260 + Math.random() * 500,
        pace: 0.88 + Math.random() * 0.26,
        lean: 0,
        hop: 0,
        tuck: 0,
      });
    }
  }

  private step(
    m: Miner,
    dt: number,
    rect: InspectionGeometry["rect"],
    vw: number,
    fieldPresent: boolean,
    squadDone: boolean,
  ): void {
    m.lean = 0;
    m.hop = 0;
    m.tuck = 0;
    for (const c of m.spills) c.t += dt / 420;
    m.spills = m.spills.filter((c) => c.t < 1);
    for (const c of m.chips) c.t += dt / 330;
    const landed = m.chips.filter((c) => c.t >= 1).length;
    if (landed) {
      m.load += landed;
      m.chips = m.chips.filter((c) => c.t < 1);
    }

    if (m.phase === "enter") {
      if (!fieldPresent) {
        this.sendHome(m); // the field vanished before they got there
        return;
      }
      const slotX = clamp(rect.left + rect.width * m.slot, 24, vw - 24);
      const remaining = slotX - m.x;
      const move = (ENTER_SPEED * dt) / 1000;
      m.stride += dt * 0.017;
      if (Math.abs(remaining) <= move) {
        m.x = slotX;
        m.phase = "mine";
      } else {
        m.x += Math.sign(remaining) * move;
        m.facing = remaining > 0 ? 1 : -1;
      }
    } else if (m.phase === "mine") {
      // Keep station on the field while it scrolls or the layout shifts.
      m.x = clamp(rect.left + rect.width * m.slot, 24, vw - 24);
      const before = swingPhase(m.mineElapsed);
      m.mineElapsed += dt;
      const after = swingPhase(m.mineElapsed);
      // The pick lands at 62 % of each swing: knock a chip loose.
      if (before < 0.62 && after >= 0.62) m.chips.push({ t: 0 });
      if (after < before) m.swingsDone += 1;
      if (m.swingsDone >= SWINGS_PER_LOAD) m.phase = "wait";
    } else if (m.phase === "wait") {
      if (fieldPresent) m.x = clamp(rect.left + rect.width * m.slot, 24, vw - 24);
      if (!squadDone) return;
      // Everyone is loaded up. A beat of dawdling, then off — most with a hop.
      m.waited += dt;
      if (m.waited < m.dawdle) return;
      if (m.jumps) m.phase = "jump";
      else this.sendHome(m);
    } else if (m.phase === "jump") {
      // Crouch, spring, and turn towards the exit in mid-air.
      m.jumpT += dt / JUMP_MS;
      if (m.jumpT > 0.45) m.facing = m.side;
      const air = Math.sin(Math.PI * Math.min(1, m.jumpT));
      m.hop = -air * 15;
      m.tuck = air;
      if (m.jumpT >= 1) this.sendHome(m);
    } else {
      this.stumbleOff(m, dt);
    }
  }

  /**
   * The getaway: quick little steps, a wobble, and every so often a foot
   * catches — the miner pitches forward, nearly goes down, loses a chip out of
   * the basket, and recovers with a skip.
   */
  private stumbleOff(m: Miner, dt: number): void {
    let speed = LEAVE_SPEED * m.pace;
    let pitch = 0;

    if (m.tripT < 0) {
      m.nextTrip -= dt;
      if (m.nextTrip <= 0) {
        m.tripT = 0;
        m.nextTrip = 650 + Math.random() * 900;
        if (m.load > 0) {
          m.load -= 1;
          m.spills.push({ t: 0 });
        }
      }
    } else {
      m.tripT += dt / TRIP_MS;
      const fall = Math.sin(Math.PI * Math.min(1, m.tripT));
      pitch = fall * 0.6;
      speed *= 1 - 0.8 * fall;
      // The recovering skip in the second half of the stumble.
      if (m.tripT > 0.55) m.hop = -Math.sin((Math.PI * (m.tripT - 0.55)) / 0.45) * 5;
      if (m.tripT >= 1) m.tripT = -1;
    }

    m.stride += dt * 0.024 * (speed / LEAVE_SPEED + 0.25);
    m.lean = pitch + Math.sin(m.stride * 0.5) * 0.1 + 0.06;
    m.x += (m.side * speed * dt) / 1000;
  }

  private sendHome(m: Miner): void {
    m.phase = "leave";
    m.facing = m.side;
  }

  private ensureLayer(): HTMLElement {
    if (this.layer && this.root?.isConnected) return this.layer;
    this.root?.remove();

    const root = document.createElement("div");
    root.id = ROOT_ID;
    Object.assign(root.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: "2147483646", // just under the eye
      pointerEvents: "none",
      width: "0",
      height: "0",
    });
    const shadow = root.attachShadow({ mode: "open" });
    const layer = document.createElement("div");
    Object.assign(layer.style, {
      position: "absolute",
      left: "0",
      top: "0",
      pointerEvents: "none",
      filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))",
    });
    shadow.appendChild(layer);
    (document.documentElement || document.body).appendChild(root);

    this.root = root;
    this.layer = layer;
    return layer;
  }
}

// --- helpers -----------------------------------------------------------------
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Position within the current swing, 0..1. */
function swingPhase(elapsedMs: number): number {
  return (elapsedMs % SWING_MS) / SWING_MS;
}

// --- drawing -----------------------------------------------------------------
// Everything is drawn facing right in a BOX_W × BOX_H box and mirrored for
// miners facing left; only the shirt badge is drawn unmirrored so its letter
// stays readable.

const SKIN = "#a9cdb4";
const SKIN_SHADE = "#84ab92";
const OUTLINE = "#1d232c";
const WOOD = "#b98545";
const WOOD_DARK = "#7c5326";
const CHIP = "#8fd6ff";
const CHIP_EDGE = "#2f7fb5";

function draw(m: Miner): void {
  const ctx = m.ctx;
  ctx.clearRect(0, 0, BOX_W, BOX_H);
  ctx.save();
  if (m.facing === -1) {
    ctx.translate(BOX_W, 0);
    ctx.scale(-1, 1);
  }

  const running = m.phase === "enter" || m.phase === "leave";
  const bob = bobOf(m);
  const cx = FOOT_X;

  // Pitch the whole figure about its feet (stumbling on the way out).
  ctx.translate(FOOT_X, FOOT_Y);
  ctx.rotate(m.lean);
  ctx.translate(-FOOT_X, -FOOT_Y);

  // Legs (drawn from the ground up so the bob only lifts the body).
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3.4;
  const swing = running ? Math.sin(m.stride) * 5.5 : 0;
  for (const dir of [-1, 1]) {
    const footX = cx + dir * 2.6 + dir * swing + dir * m.tuck * 2.5;
    // Feet lift alternately while running, and tuck up together in a jump.
    const lift = (running ? Math.max(0, -Math.sin(m.stride) * dir) * 3 : 0) + m.tuck * 4.5;
    ctx.beginPath();
    ctx.moveTo(cx + dir * 2.6, FOOT_Y - 10 + bob);
    ctx.lineTo(footX, FOOT_Y - 1.6 - lift);
    ctx.stroke();
    // Boot.
    ctx.beginPath();
    ctx.moveTo(footX - 0.5, FOOT_Y - 1.6 - lift);
    ctx.lineTo(footX + 3, FOOT_Y - 1.6 - lift);
    ctx.stroke();
  }

  ctx.translate(0, bob);

  drawBasket(ctx, cx, m.load);

  // Shirt.
  const top = FOOT_Y - 27;
  roundRect(ctx, cx - 8, top, 16, 18, 5);
  ctx.fillStyle = m.shirt.body;
  ctx.fill();
  if (m.shirt.stripes) {
    // Brand-colour bands across the hem.
    ctx.save();
    roundRect(ctx, cx - 8, top, 16, 18, 5);
    ctx.clip();
    const w = 16 / m.shirt.stripes.length;
    m.shirt.stripes.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(cx - 8 + i * w, top + 13.5, w + 0.3, 4.5);
    });
    ctx.restore();
  }
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = OUTLINE;
  roundRect(ctx, cx - 8, top, 16, 18, 5);
  ctx.stroke();
  // Basket strap over the shoulder.
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - 7, top + 2.5);
  ctx.lineTo(cx + 1, top + 14);
  ctx.stroke();

  // Head.
  const hy = top - 7;
  ctx.fillStyle = SKIN_SHADE; // pointed ear, behind the head
  ctx.beginPath();
  ctx.moveTo(cx - 7, hy - 1);
  ctx.lineTo(cx - 13.5, hy - 5);
  ctx.lineTo(cx - 8, hy + 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(cx + 1, hy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Eye + grin.
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx + 5, hy + 0.5, 2.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(cx + 5.9, hy + 0.8, 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(cx + 4, hy + 3.6, 3.2, 0.25, 1.75);
  ctx.stroke();
  // Hard hat with a lamp.
  ctx.fillStyle = "#4b5263";
  ctx.beginPath();
  ctx.arc(cx + 1, hy - 1.5, 9.4, Math.PI, 0);
  ctx.lineTo(cx + 13, hy - 1.5);
  ctx.lineTo(cx + 13, hy);
  ctx.lineTo(cx - 8.4, hy);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = "#fff3b0";
  ctx.beginPath();
  ctx.arc(cx + 8, hy - 5.5, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  drawPick(ctx, cx, top, m);

  // Chips flying from the pick into the basket.
  for (const c of m.chips) {
    const x = lerp(cx + 21, cx - 14, c.t);
    const y = lerp(FOOT_Y - 2, top - 2, c.t) - Math.sin(c.t * Math.PI) * 15;
    drawChip(ctx, x, y, 3.4, c.t * 5);
  }
  // Chips bouncing out of the basket during a stumble.
  for (const c of m.spills) {
    const x = lerp(cx - 14, cx - 31, c.t);
    const y = lerp(top - 3, FOOT_Y - 2 - bob, c.t * c.t) - Math.sin(c.t * Math.PI) * 9;
    drawChip(ctx, x, y, 3.2, c.t * 7);
  }
  // Sparks at the moment of impact.
  if (m.phase === "mine") {
    const p = swingPhase(m.mineElapsed);
    if (p > 0.6 && p < 0.82) {
      ctx.strokeStyle = "#ffd76a";
      ctx.lineWidth = 1.2;
      for (const a of [-2.4, -1.6, -0.8]) {
        ctx.beginPath();
        ctx.moveTo(cx + 22 + Math.cos(a) * 3, FOOT_Y - 2 + Math.sin(a) * 3);
        ctx.lineTo(cx + 22 + Math.cos(a) * 7, FOOT_Y - 2 + Math.sin(a) * 7);
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  drawBadge(m, bob);
}

/** How far the body is lifted off its legs this frame (negative = up). */
function bobOf(m: Miner): number {
  if (m.phase === "enter" || m.phase === "leave") return Math.abs(Math.sin(m.stride)) * -2.2;
  if (m.phase === "wait") return Math.sin(m.waited * 0.03) * -0.8; // shifting about
  if (m.phase === "jump") return m.jumpT < 0.2 ? (m.jumpT / 0.2) * 2.5 : 0; // crouch first
  return 0;
}

/** Wooden basket on the miner's back, with the chips collected so far. */
function drawBasket(ctx: CanvasRenderingContext2D, cx: number, load: number): void {
  const top = FOOT_Y - 29;
  const bottom = FOOT_Y - 11;
  const outer = cx - 21;
  const inner = cx - 8;

  // Collected chips heaped over the rim.
  const heap = Math.min(load, 6);
  for (let i = 0; i < heap; i++) {
    const x = outer + 3 + ((i * 3.7) % 9);
    const y = top - 1 - Math.floor(i / 3) * 2.6 - (i % 2);
    drawChip(ctx, x, y, 3.2, i * 1.3);
  }

  ctx.beginPath();
  ctx.moveTo(outer, top);
  ctx.lineTo(inner, top);
  ctx.lineTo(inner - 1, bottom);
  ctx.lineTo(outer + 2.5, bottom);
  ctx.closePath();
  ctx.fillStyle = WOOD;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 0.9;
  for (let y = top + 4; y < bottom; y += 4) {
    ctx.beginPath();
    ctx.moveTo(outer, y);
    ctx.lineTo(inner, y);
    ctx.stroke();
  }
  for (let x = outer + 3.5; x < inner; x += 3.5) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + 0.6, bottom);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Rim.
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(outer - 0.5, top);
  ctx.lineTo(inner + 0.5, top);
  ctx.stroke();
}

/** Arm and pickaxe: shouldered while running, swinging while mining. */
function drawPick(ctx: CanvasRenderingContext2D, cx: number, shirtTop: number, m: Miner): void {
  // Resting over the shoulder; jiggling on the run, flung up in a stumble.
  let angle = -2.2 + (m.phase === "leave" ? Math.sin(m.stride) * 0.22 - m.lean * 0.9 : 0) - m.tuck * 0.5;
  if (m.phase === "mine") {
    const p = swingPhase(m.mineElapsed);
    // Wind up slowly, strike fast, hold a beat.
    angle = p < 0.62 ? lerp(-2.5, 0.72, Math.pow(p / 0.62, 2.4)) : lerp(0.72, -2.5, (p - 0.62) / 0.38);
  }
  const sx = cx + 5;
  const sy = shirtTop + 5;
  const hx = sx + Math.cos(angle) * 8.5;
  const hy = sy + Math.sin(angle) * 8.5;
  const tx = sx + Math.cos(angle) * 23;
  const ty = sy + Math.sin(angle) * 23;

  // Handle.
  ctx.lineCap = "round";
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(sx + Math.cos(angle) * 4, sy + Math.sin(angle) * 4);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  // Head of the pick: a curved blade across the end of the handle.
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  ctx.strokeStyle = "#c9d2de";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(tx - nx * 7 - Math.cos(angle) * 3, ty - ny * 7 - Math.sin(angle) * 3);
  ctx.quadraticCurveTo(tx + Math.cos(angle) * 2.5, ty + Math.sin(angle) * 2.5, tx + nx * 7 - Math.cos(angle) * 3, ty + ny * 7 - Math.sin(angle) * 3);
  ctx.stroke();
  // Arm (sleeve in shirt colour) and hand.
  ctx.strokeStyle = m.shirt.body;
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(hx, hy, 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** A chipped-off block of data: deliberately generic, never a character. */
function drawChip(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, spin: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.fillStyle = CHIP;
  ctx.strokeStyle = CHIP_EDGE;
  ctx.lineWidth = 0.8;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

/** The organisation's badge on the chest, drawn unmirrored so it reads. */
function drawBadge(m: Miner, bob: number): void {
  const ctx = m.ctx;
  // The chest, relative to the feet, pitched by the same lean as the body.
  const dx = 2.2;
  const dy = -19 + bob;
  const px = FOOT_X + dx * Math.cos(m.lean) - dy * Math.sin(m.lean);
  const x = m.facing === 1 ? px : BOX_W - px;
  const y = FOOT_Y + dx * Math.sin(m.lean) + dy * Math.cos(m.lean);
  ctx.save();
  ctx.fillStyle = m.shirt.badge;
  ctx.beginPath();
  ctx.arc(x, y, 4.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = m.shirt.ink;
  ctx.font = "700 7px system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(m.shirt.letter, x, y + 0.5);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
