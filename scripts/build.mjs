// Build script for the Tracker Eye WebExtension.
//
// We use esbuild (single dependency, no config sprawl) to bundle the three
// TypeScript entry points into the `dist/` directory and then copy the static
// assets (manifest, popup HTML/CSS, icons) alongside them.
//
//   node scripts/build.mjs           one-off production build
//   node scripts/build.mjs --watch   rebuild on change (for development)
//
// The output in dist/ is exactly what you load via about:debugging.

import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "dist");
const watch = process.argv.includes("--watch");

// Each WebExtension context (background, content, page-world probe, popup) is a
// separate, self-contained bundle. They communicate only through the messaging
// layer, never by sharing a module graph at runtime.
const entryPoints = {
  "background/index": "src/background/index.ts",
  "content/index": "src/content/index.ts",
  "content/fingerprint-probe": "src/content/fingerprint-probe.ts",
  "popup/popup": "src/popup/popup.ts",
};

/** Copy the static files that esbuild does not process. */
async function copyStatic() {
  await cp(resolve(root, "src/manifest.json"), resolve(outdir, "manifest.json"));
  await mkdir(resolve(outdir, "popup"), { recursive: true });
  await cp(resolve(root, "src/popup/popup.html"), resolve(outdir, "popup/popup.html"));
  await cp(resolve(root, "src/popup/popup.css"), resolve(outdir, "popup/popup.css"));
  if (existsSync(resolve(root, "icons"))) {
    await cp(resolve(root, "icons"), resolve(outdir, "icons"), { recursive: true });
  }
}

const options = {
  entryPoints: Object.fromEntries(
    Object.entries(entryPoints).map(([out, src]) => [out, resolve(root, src)]),
  ),
  outdir,
  bundle: true,
  format: "iife", // WebExtension scripts are classic scripts, not ES modules.
  target: ["firefox109"],
  platform: "browser",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (watch) {
  const ctx = await context(options);
  await ctx.rebuild();
  await copyStatic();
  await ctx.watch();
  console.log("[tracker-eye] watching for changes… (Ctrl-C to stop)");
} else {
  await build(options);
  await copyStatic();
  console.log("[tracker-eye] build complete -> dist/");
}
