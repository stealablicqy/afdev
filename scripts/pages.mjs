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

// Advanced-mode Pages worker: the same Wisp + Bare handler the Workers deploy
// runs, with the bare.mjs module beside it so the relative import resolves.
await copyFile(path.join(root, "relay", "worker.mjs"), path.join(dist, "_worker.js"));
await copyFile(path.join(root, "relay", "bare.mjs"), path.join(dist, "bare.mjs"));

console.log("pages: dist/ ready (public + _worker.js)");
