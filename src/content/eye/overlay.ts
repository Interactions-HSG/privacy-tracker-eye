// Overlay host for the eye.
// -----------------------------------------------------------------------------
// Creates a fixed, click-through, style-isolated (Shadow DOM) container and
// hosts the eye's <canvas> inside it. Style isolation means the page's CSS
// cannot affect the eye and vice versa. pointer-events:none means the eye never
// intercepts clicks — it only watches.
//
// Since v0.2 the host is pinned to the viewport origin and the eye positions
// *itself* with a transform (see Eye.targetPlacement), because it no longer
// only sits in a corner: it flies to whatever field is being filled in.

import { resolveSkin } from "./skins";
import type { Config } from "../../shared/types";
import { Eye, type InspectionTarget } from "./eye";

const ROOT_ID = "tracker-eye-root";
const MARGIN = 18;

export class EyeOverlay {
  private root: HTMLElement | null = null;
  private eye: Eye | null = null;
  private config: Config | null = null;
  private pendingInspection: InspectionTarget | null = null;

  /** Create or update the overlay for the given config. */
  apply(config: Config, dominantOrganization: string | null): void {
    const sizeChanged = this.config?.size !== config.size;

    if (!config.eyeEnabled) {
      this.destroy();
      this.config = config;
      return;
    }

    if (!this.root || sizeChanged) {
      this.rebuild(config);
    }
    this.eye?.setLayout(this.layoutFor(config));
    this.eye?.setSkin(resolveSkin(config.skin, dominantOrganization));
    this.config = config;
  }

  setIntensity(value: number): void {
    this.eye?.setIntensity(value);
  }

  setCursor(x: number, y: number): void {
    this.eye?.setCursor(x, y);
  }

  /** Send the eye to a form field (or call with null to send it home). */
  inspect(target: InspectionTarget | null): void {
    this.pendingInspection = target;
    this.eye?.inspect(target);
  }

  private layoutFor(config: Config) {
    return {
      corner: config.corner,
      margin: MARGIN,
      width: config.size,
      height: Math.round(config.size * 0.8), // taller canvas => rounder eye
    };
  }

  private rebuild(config: Config): void {
    this.destroy();

    const root = document.createElement("div");
    root.id = ROOT_ID;
    Object.assign(root.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: "2147483647", // top of the stack
      pointerEvents: "none",
      width: "0",
      height: "0",
    });

    const shadow = root.attachShadow({ mode: "open" });

    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      position: "absolute",
      left: "0",
      top: "0",
      transformOrigin: "0 0", // so translate() places the box's top-left exactly
      pointerEvents: "none",
      willChange: "transform",
      filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.25))",
    });

    const layout = this.layoutFor(config);
    const dpr = Math.min(3, window.devicePixelRatio || 1);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    Object.assign(canvas.style, {
      width: `${layout.width}px`,
      height: `${layout.height}px`,
      display: "block",
    });

    wrapper.appendChild(canvas);
    shadow.appendChild(wrapper);

    // documentElement is always present, even at document_start before <body>.
    (document.documentElement || document.body).appendChild(root);

    this.root = root;
    this.eye = new Eye(canvas, wrapper, layout);
    this.eye.setSkin(resolveSkin(config.skin, null));
    if (this.pendingInspection) this.eye.inspect(this.pendingInspection);
    this.eye.start();
  }

  destroy(): void {
    this.eye?.stop();
    this.eye = null;
    this.root?.remove();
    this.root = null;
  }
}
