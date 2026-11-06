// Builds the Cloudflare Pages upload: every static file from public/, plus
// worker.js copied in as the advanced-mode _worker.js. Pages serves the static
// files first and hands unmatched routes to the worker, which is the same
// handler that runs on Workers, so /api/* keeps working after the move.
import { cp, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, "public"), dist, { recursive: true });
await copyFile(path.join(root, "worker.js"), path.join(dist, "_worker.js"));

console.log("pages: dist/ ready (public + _worker.js)");
