// Development server for browser-side verification.
// Serves the site tree with correct content types so a page renders exactly as it
// does from the CDN. Loopback only; not part of the published site.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || 8793);

const TYPES = {
	// jsDelivr serves .html as text/plain. Mirroring that here keeps local runs
	// faithful to production, where the service worker is what re-wraps a proxied
	// document as HTML.
	".html": "text/plain; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".wasm": "application/wasm",
	".mp3": "audio/mpeg",
	".map": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
	res.setHeader("access-control-allow-origin", "*");
	res.setHeader("cache-control", "no-store");
	const url = new URL(req.url, "http://127.0.0.1");
	let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
	if (rel === "" || rel.endsWith("/")) rel += "index.html";
	const target = path.resolve(root, rel);
	if (!target.startsWith(root) || !(await stat(target).catch(() => null))?.isFile()) {
		res.statusCode = 404;
		res.setHeader("content-type", "text/plain; charset=utf-8");
		res.end("not found " + rel);
		return;
	}
	// Faithful to the CDN: .html goes out as text/plain so the entry point is
	// exercised through the .svg wrapper and the service worker's re-wrap path.
	res.setHeader("content-type", TYPES[path.extname(target)] || "application/octet-stream");
	res.end(await readFile(target));
});

server.listen(port, "127.0.0.1", () => console.log(`dev server on http://127.0.0.1:${port}`));
