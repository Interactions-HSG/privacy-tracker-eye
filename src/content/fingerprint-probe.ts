// In-page fingerprinting probe (runs in the PAGE world, not the content-script
// isolated world, so it can observe the real APIs that page scripts call).
// -----------------------------------------------------------------------------
// It instruments the canonical browser-fingerprinting vectors and reports
// batched, debounced counts to the content script via window.postMessage. It
// never blocks or alters behaviour — every wrapper calls through to the original
// and every hook is wrapped in try/catch so a page can never be broken by it.

import { PROBE_MESSAGE_TAG, type ProbeWindowMessage } from "../shared/messages";
import type { FingerprintEvidence } from "../shared/types";

(() => {
  // Guard against double injection (e.g. bfcache restores).
  const w = window as unknown as { __trackerEyeProbe__?: boolean };
  if (w.__trackerEyeProbe__) return;
  w.__trackerEyeProbe__ = true;

  const pending: FingerprintEvidence = { canvas: 0, webgl: 0, audio: 0, fonts: 0, enumeration: 0 };
  let flushScheduled = false;

  function bump(key: keyof FingerprintEvidence, n = 1): void {
    pending[key] += n;
    if (flushScheduled) return;
    flushScheduled = true;
    setTimeout(flush, 800);
  }

  function flush(): void {
    flushScheduled = false;
    const evidence: Partial<FingerprintEvidence> = {};
    let any = false;
    (Object.keys(pending) as (keyof FingerprintEvidence)[]).forEach((k) => {
      if (pending[k] > 0) {
        evidence[k] = pending[k];
        pending[k] = 0;
        any = true;
      }
    });
    if (!any) return;
    const msg: ProbeWindowMessage = { tag: PROBE_MESSAGE_TAG, evidence };
    try {
      window.postMessage(msg, "*");
    } catch {
      /* ignore */
    }
  }

  // Replace a method while preserving identity as much as possible.
  function wrap<T extends object>(obj: T, name: keyof T, factory: (orig: any) => any): void {
    try {
      const orig = obj[name] as unknown as (...a: any[]) => any;
      if (typeof orig !== "function") return;
      const replacement = factory(orig);
      // Make toString() look like the native fn to avoid trivially breaking
      // pages that sanity-check their own APIs.
      try {
        replacement.toString = () => orig.toString();
      } catch {
        /* ignore */
      }
      (obj as any)[name] = replacement;
    } catch {
      /* ignore */
    }
  }

  // --- Canvas read-back ------------------------------------------------------
  wrap(HTMLCanvasElement.prototype, "toDataURL", (orig) =>
    function (this: HTMLCanvasElement, ...args: any[]) {
      bump("canvas");
      return orig.apply(this, args);
    },
  );
  wrap(HTMLCanvasElement.prototype, "toBlob", (orig) =>
    function (this: HTMLCanvasElement, ...args: any[]) {
      bump("canvas");
      return orig.apply(this, args);
    },
  );
  if (typeof CanvasRenderingContext2D !== "undefined") {
    wrap(CanvasRenderingContext2D.prototype, "getImageData", (orig) =>
      function (this: CanvasRenderingContext2D, ...args: any[]) {
        bump("canvas");
        return orig.apply(this, args);
      },
    );
    // Font enumeration: measureText on a canvas that is NOT in the document is a
    // strong "sweeping fonts offscreen" signal; visible text rendering is not.
    wrap(CanvasRenderingContext2D.prototype, "measureText", (orig) =>
      function (this: CanvasRenderingContext2D, ...args: any[]) {
        try {
          const canvas = this.canvas as HTMLCanvasElement | undefined;
          if (canvas && !canvas.isConnected) bump("fonts");
        } catch {
          /* ignore */
        }
        return orig.apply(this, args);
      },
    );
  }

  // --- WebGL renderer probing ------------------------------------------------
  const DEBUG_RENDERER = "WEBGL_debug_renderer_info";
  for (const ctor of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
    const proto = (window as any)[ctor]?.prototype;
    if (!proto) continue;
    wrap(proto, "getExtension", (orig) =>
      function (this: any, name: string, ...rest: any[]) {
        if (name === DEBUG_RENDERER) bump("webgl");
        return orig.call(this, name, ...rest);
      },
    );
    wrap(proto, "getParameter", (orig) =>
      function (this: any, param: number, ...rest: any[]) {
        // UNMASKED_VENDOR_WEBGL (37445) / UNMASKED_RENDERER_WEBGL (37446)
        if (param === 37445 || param === 37446) bump("webgl");
        return orig.call(this, param, ...rest);
      },
    );
  }

  // --- AudioContext fingerprinting -------------------------------------------
  if (typeof (window as any).OfflineAudioContext !== "undefined") {
    wrap((window as any).OfflineAudioContext.prototype, "startRendering", (orig) =>
      function (this: any, ...args: any[]) {
        bump("audio");
        return orig.apply(this, args);
      },
    );
  }
  for (const ctor of ["AudioContext", "webkitAudioContext"]) {
    const proto = (window as any)[ctor]?.prototype;
    if (!proto) continue;
    wrap(proto, "createDynamicsCompressor", (orig) =>
      function (this: any, ...args: any[]) {
        bump("audio");
        return orig.apply(this, args);
      },
    );
  }

  // --- Device / environment enumeration --------------------------------------
  wrap(Date.prototype, "getTimezoneOffset", (orig) =>
    function (this: Date, ...args: any[]) {
      bump("enumeration");
      return orig.apply(this, args);
    },
  );
  try {
    if (navigator.mediaDevices) {
      wrap(navigator.mediaDevices, "enumerateDevices", (orig) =>
        function (this: any, ...args: any[]) {
          bump("enumeration");
          return orig.apply(this, args);
        },
      );
    }
  } catch {
    /* ignore */
  }
  for (const ctor of ["RTCPeerConnection", "webkitRTCPeerConnection"]) {
    const Orig = (window as any)[ctor];
    if (typeof Orig !== "function") continue;
    try {
      const Wrapped = function (this: any, ...args: any[]) {
        bump("enumeration");
        return new Orig(...args);
      } as any;
      Wrapped.prototype = Orig.prototype;
      (window as any)[ctor] = Wrapped;
    } catch {
      /* ignore */
    }
  }
  // navigator.plugins length read (classic enumeration) — only if redefinable.
  try {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "plugins");
    if (desc?.get && desc.configurable) {
      const origGet = desc.get;
      Object.defineProperty(Navigator.prototype, "plugins", {
        configurable: true,
        get() {
          bump("enumeration");
          return origGet.call(this);
        },
      });
    }
  } catch {
    /* ignore */
  }
})();
