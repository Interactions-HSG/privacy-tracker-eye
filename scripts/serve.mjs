// Static server for the study fixture (docs/study-site).
//
//   node scripts/serve.mjs          →  http://localhost:8137
//   node scripts/serve.mjs 9000     →  http://localhost:9000
//
// Why serve it instead of opening the files? Content scripts and the
// webRequest observer behave differently on file:// URLs, so a study run
// should use a real http origin. Nothing is written or logged here: the
// fixture's forms never submit (see docs/study-site/assets/next.js).

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "study-site");
const port = Number(process.argv[2]) || 8137;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  const requested = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const relative = normalize(requested === "/" ? "/index.html" : requested).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, relative);

  // Never serve anything outside the fixture directory.
  if (!file.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store", // always serve the current edit during a study
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end('<h1>404</h1><p><a href="/">Back to the shop</a></p>');
  }
}).listen(port, () => {
  console.log(`[tracker-eye] study fixture on http://localhost:${port}/`);
  console.log("[tracker-eye] Ctrl-C to stop");
});
