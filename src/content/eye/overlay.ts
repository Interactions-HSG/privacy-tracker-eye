// Overlay host for the eye.
// -----------------------------------------------------------------------------
// Creates a fixed, click-through, style-isolated (Shadow DOM) container in the
// chosen screen corner and hosts the eye's <canvas>. Style isolation means the
// page's CSS cannot affect the eye and vice versa. pointer-events:none means the
// eye never intercepts clicks — it only watches.

import type { Config } from "../../shared/types";
import { Eye } from "./eye";

const ROOT_ID = "tracker-eye-root";

interface Vec {
  x: number;
  y: number;
}

/** Unit vector pointing "off the screen" for each corner (for the drift). */
function driftDirectionFor(corner: Config["corner"]): Vec {
  switch (corner) {
    case "top-right":
      return { x: 1, y: -1 };
    case "top-left":
      return { x: -1, y: -1 };
    case "bottom-right":
      return { x: 1, y: 1 };
    case "bottom-left":
      return { x: -1, y: 1 };
  }
}

function cornerStyles(corner: Config["corner"]): Partial<CSSStyleDeclaration> {
  const m = "18px";
  switch (corner) {
    case "top-right":
      return { top: m, right: m };
    case "top-left":
      return { top: m, left: m };
    case "bottom-right":
      return { bottom: m, right: m };
    case "bottom-left":
      return { bottom: m, left: m };
  }
}

export class EyeOverlay {
  private root: HTMLElement | null = null;
  private eye: Eye | null = null;
  private config: Config | null = null;

  /** Create or update the overlay for the given config. */
  apply(config: Config): void {
    const cornerChanged = this.config?.corner !== config.corner;
    const sizeChanged = this.config?.size !== config.size;

    if (!config.eyeEnabled) {
      this.destroy();
      this.config = config;
      return;
    }

    if (!this.root || cornerChanged || sizeChanged) {
      this.rebuild(config);
    }
    this.config = config;
  }

  setIntensity(value: number): void {
    this.eye?.setIntensity(value);
  }

  setCursor(x: number, y: number): void {
    this.eye?.setCursor(x, y);
  }

  private rebuild(config: Config): void {
    this.destroy();

    const root = document.createElement("div");
    root.id = ROOT_ID;
    Object.assign(root.style, {
      position: "fixed",
      zIndex: "2147483647", // top of the stack
      pointerEvents: "none",
      width: "0",
      height: "0",
    });
    Object.assign(root.style, cornerStyles(config.corner));

    const shadow = root.attachShadow({ mode: "open" });

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      pointerEvents: "none",
      willChange: "transform",
      filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.25))",
    });

    const w = config.size;
    const h = Math.round(config.size * 0.8); // taller canvas => rounder eye
    const dpr = Math.min(3, window.devicePixelRatio || 1);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    Object.assign(canvas.style, {
      width: `${w}px`,
      height: `${h}px`,
      display: "block",
    });

    wrapper.appendChild(canvas);
    shadow.appendChild(wrapper);

    // documentElement is always present, even at document_start before <body>.
    (document.documentElement || document.body).appendChild(root);

    this.root = root;
    this.eye = new Eye(canvas, wrapper, driftDirectionFor(config.corner));
    this.eye.start();
  }

  destroy(): void {
    this.eye?.stop();
    this.eye = null;
    this.root?.remove();
    this.root = null;
  }
}
