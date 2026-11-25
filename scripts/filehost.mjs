// Tiny read-only file server used by the browser-side publish helper.
// Serves the project tree with permissive CORS so the github.com tab can fetch
// the files it needs to upload. Binds to loopback only.
import { createServer } from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || 8792);
const SKIP = new Set(["node_modules", ".git", ".wrangler", "dist"]);

async function walk(dir, base = "") {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) continue;
		const rel = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...await walk(path.join(dir, entry.name), rel));
		else out.push(rel);
	}
	return out;
}

const server = createServer(async (req, res) => {
	res.setHeader("access-control-allow-origin", "*");
	res.setHeader("access-control-allow-private-network", "true");
	res.setHeader("cache-control", "no-store");
	if (req.method === "OPTIONS") {
		res.setHeader("access-control-allow-headers", "*");
		res.setHeader("access-control-allow-methods", "GET,OPTIONS");
		res.setHeader("access-control-max-age", "600");
		res.end();
		return;
	}
	const url = new URL(req.url, "http://127.0.0.1");
	if (url.pathname === "/_list") {
		// Only what GitHub needs: the publishable site tree.
		const files = (await walk(path.join(root, "public"))).map(f => `public/${f}`);
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify(files));
		return;
	}
	const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
	const target = path.resolve(root, rel);
	if (!target.startsWith(root) || !(await stat(target).catch(() => null))?.isFile()) {
		res.statusCode = 404;
		res.end("not found");
		return;
	}
	res.setHeader("content-type", "application/octet-stream");
	res.end(await readFile(target));
});

server.listen(port, "127.0.0.1", () => console.log(`filehost on http://127.0.0.1:${port}`));
