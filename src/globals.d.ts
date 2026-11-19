// Build-time constants injected by scripts/build.mjs (esbuild `define`).

/**
 * True in the Chrome build, where the fingerprint probe is declared in the
 * manifest as a MAIN-world content script instead of being injected by the
 * content script.
 */
declare const __PROBE_IN_MANIFEST__: boolean;
