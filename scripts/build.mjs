// Copies the proxy vendor files out of node_modules into public/ and lays down
// the service-worker entrypoints kept in src/. Nothing here is bundled: every
// artifact we copy is already a browser-ready module or classic script, and
// bundling them again just risks breaking the wasm base64 payload inside
// epoxy-transport's dist build.
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nm = (...p) => path.join(root, "node_modules", ...p);
const pub = (...p) => path.join(root, "public", ...p);
const src = (...p) => path.join(root, "src", ...p);

const uvDist = nm("@titaniumnetwork-dev", "ultraviolet", "dist");
const sjDist = nm("@mercuryworkshop", "scramjet", "dist");
const bmDist = nm("@mercuryworkshop", "bare-mux", "dist");
const epoxyDist = nm("@mercuryworkshop", "epoxy-transport", "dist");

const manfest = [
	[path.join(uvDist, "uv.bundle.js"), pub("uv", "uv.bundle.js")],
	[path.join(uvDist, "uv.handler.js"), pub("uv", "uv.handler.js")],
	[path.join(uvDist, "uv.client.js"), pub("uv", "uv.client.js")],
	[path.join(uvDist, "uv.sw.js"), pub("uv", "uv.sw.js")],

	[path.join(sjDist, "scramjet.all.js"), pub("scramjet", "scramjet.all.js")],
	[path.join(sjDist, "scramjet.wasm.wasm"), pub("scramjet", "scramjet.wasm.wasm")],
	[path.join(sjDist, "scramjet.sync.js"), pub("scramjet", "scramjet.sync.js")],

	[path.join(bmDist, "index.mjs"), pub("baremux", "baremux.mjs")],
	[path.join(bmDist, "worker.js"), pub("baremux", "worker.js")],

	[path.join(epoxyDist, "index.mjs"), pub("transport", "epoxy-client.mjs")],

	[src("transport", "epoxy.mjs"), pub("transport", "epoxy.mjs")],

	[src("uv", "uv.config.js"), pub("uv", "uv.config.js")],
	[src("uv", "sw.js"), pub("uv", "sw.js")],
	[src("scramjet", "sw.js"), pub("scramjet", "sw.js")],
];

let total = 0;

for (const [from, to] of manfest) {
	if (!existsSync(from)) {
		console.error(`missing source: ${path.relative(root, from)}`);
		process.exitCode = 1;
		continue;
	}
	await mkdir(path.dirname(to), { recursive: true });
	await cp(from, to, { force: true });
	const { size } = await stat(to);
	total += size;
	console.log(`${String(Math.round(size / 1024)).padStart(6)} KB  ${path.relative(root, to)}`);
}

// bare-mux resolves its SharedWorker through localStorage["bare-mux-path"],
// which only gets written by setTransport(). worker.js is already a plain
// SharedWorker script — copying it verbatim is the whole job.

const sizeReport = `${(total / 1024 / 1024).toFixed(2)} MB of proxy assets in public/`;
console.log(`\n${sizeReport}`);

// Fail loudly if a copied module accidentally kept a bare import — bare-mux
// dynamic-imports these inside a SharedWorker where there is no specifier
// resolution beyond the URL itself.
const checked = [pub("transport", "epoxy.mjs"), pub("transport", "epoxy-client.mjs")];
for (const file of checked) {
	const text = await readFile(file, "utf8");
	const bare = [...text.matchAll(/(?:from|import)\s*["']([^"'./][^"']*)["']/g)]
		.map((match) => match[1])
		.filter((specifier) => !specifier.startsWith("data:"));
	if (bare.length) {
		console.error(`bare imports in ${path.relative(root, file)}: ${bare.join(", ")}`);
		process.exitCode = 1;
	}
}
