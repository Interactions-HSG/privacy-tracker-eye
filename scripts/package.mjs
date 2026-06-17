// Package dist/ into an unsigned .zip suitable for submission to
// addons.mozilla.org (AMO) or for `web-ext sign`. Run `npm run build` first.
//
//   node scripts/package.mjs
//
// Produces web-ext-artifacts/tracker-eye-<version>.zip

import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { createDeflateRaw } from "node:zlib";

// Minimal zip writer (store/deflate) so packaging needs no extra dependency.
// For anything beyond local testing, prefer Mozilla's `web-ext build`.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distdir = resolve(root, "dist");
const outDir = resolve(root, "web-ext-artifacts");

const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, `tracker-eye-${pkg.version}.zip`);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function deflate(buf) {
  return new Promise((res, rej) => {
    const chunks = [];
    const z = createDeflateRaw();
    z.on("data", (d) => chunks.push(d));
    z.on("end", () => res(Buffer.concat(chunks)));
    z.on("error", rej);
    z.end(buf);
  });
}

const central = [];
const local = [];
let offset = 0;

for await (const file of walk(distdir)) {
  const name = relative(distdir, file).split("\\").join("/");
  const data = await readFile(file);
  const crc = crc32(data);
  const comp = await deflate(data);
  const nameBuf = Buffer.from(name, "utf8");

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0, 6);
  lh.writeUInt16LE(8, 8); // deflate
  lh.writeUInt32LE(0, 10);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  local.push(lh, nameBuf, comp);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0, 8);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(0, 12);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, nameBuf);

  offset += lh.length + nameBuf.length + comp.length;
}

const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(local.length / 3, 8);
eocd.writeUInt16LE(local.length / 3, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

const out = createWriteStream(outPath);
for (const b of local) out.write(b);
out.write(centralBuf);
out.write(eocd);
out.end(() => console.log(`[tracker-eye] packaged -> ${relative(root, outPath)}`));

await stat(distdir).catch(() => {
  throw new Error("dist/ not found — run `npm run build` first.");
});
