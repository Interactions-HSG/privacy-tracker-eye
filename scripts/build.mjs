// Build script for the Tracker Eye WebExtension.
//
// We use esbuild (single dependency, no config sprawl) to bundle the
// TypeScript entry points and then copy the static assets (manifest, popup
// HTML/CSS, icons) alongside them. One source tree, two loadable builds:
//
//   dist/          Firefox (Manifest V2)  — load via about:debugging
//   dist-chrome/   Chrome / Edge (Manifest V3) — load via chrome://extensions
//
//   node scripts/build.mjs           one-off production build of both
//   node scripts/build.mjs --watch   rebuild both on change (for development)

import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

/**
 * Derive the Chrome MV3 manifest from the Firefox MV2 one, so name, version
 * and description have a single source of truth (src/manifest.json).
 */
function chromeManifest(firefox) {
  const hosts = firefox.permissions.filter((p) => p.includes("://") || p === "<all_urls>");
  const icons = { 16: "icons/eye-16.png", 32: "icons/eye-32.png", 48: "icons/eye-48.png", 128: "icons/eye-128.png" };
  const [content] = firefox.content_scripts;
  return {
    manifest_version: 3,
    name: firefox.name,
    version: firefox.version,
    description: firefox.description,
    minimum_chrome_version: "111", // MAIN-world content scripts
    icons, // Chrome does not accept SVG icons
    permissions: firefox.permissions.filter((p) => !hosts.includes(p)),
    host_permissions: hosts,
    background: { service_worker: "background/index.js" },
    content_scripts: [
      content,
      // The fingerprint probe runs in the page's own world. Chrome can declare
      // that directly, which replaces the <script> injection (and the
      // web_accessible_resources entry) the Firefox build uses.
      {
        matches: content.matches,
        js: firefox.web_accessible_resources,
        run_at: "document_start",
        all_frames: false,
        world: "MAIN",
      },
    ],
    action: {
      default_title: firefox.browser_action.default_title,
      default_popup: firefox.browser_action.default_popup,
      default_icon: icons,
    },
  };
}

const targets = [
  {
    name: "firefox",
    outdir: resolve(root, "dist"),
    esbuildTarget: ["firefox109"],
    define: { __PROBE_IN_MANIFEST__: "false" },
    manifest: (firefox) => firefox,
  },
  {
    name: "chrome",
    outdir: resolve(root, "dist-chrome"),
    esbuildTarget: ["chrome111"],
    // The source is written against the promise-based `browser.*` namespace.
    // Chrome MV3 offers the same promise API as `chrome.*`, so the Chrome
    // bundle simply reads the global `browser` as `chrome`.
    define: { __PROBE_IN_MANIFEST__: "true", browser: "chrome" },
    manifest: chromeManifest,
  },
];

/** Copy the static files that esbuild does not process. */
async function copyStatic({ outdir, manifest }) {
  const source = JSON.parse(await readFile(resolve(root, "src/manifest.json"), "utf8"));
  await writeFile(
    resolve(outdir, "manifest.json"),
    JSON.stringify(manifest(source), null, 2) + "\n",
  );
  await mkdir(resolve(outdir, "popup"), { recursive: true });
  await cp(resolve(root, "src/popup/popup.html"), resolve(outdir, "popup/popup.html"));
  await cp(resolve(root, "src/popup/popup.css"), resolve(outdir, "popup/popup.css"));
  if (existsSync(resolve(root, "icons"))) {
    await cp(resolve(root, "icons"), resolve(outdir, "icons"), { recursive: true });
  }
}

const optionsFor = (target) => ({
  entryPoints: Object.fromEntries(
    Object.entries(entryPoints).map(([out, src]) => [out, resolve(root, src)]),
  ),
  outdir: target.outdir,
  bundle: true,
  format: "iife", // WebExtension scripts are classic scripts, not ES modules.
  target: target.esbuildTarget,
  platform: "browser",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"', ...target.define },
});

for (const target of targets) {
  await rm(target.outdir, { recursive: true, force: true });
  await mkdir(target.outdir, { recursive: true });

  if (watch) {
    const ctx = await context(optionsFor(target));
    await ctx.rebuild();
    await copyStatic(target);
    await ctx.watch();
  } else {
    await build(optionsFor(target));
    await copyStatic(target);
  }
}

console.log(
  watch
    ? "[tracker-eye] watching for changes… (Ctrl-C to stop)"
    : "[tracker-eye] build complete -> dist/ (Firefox), dist-chrome/ (Chrome)",
);
