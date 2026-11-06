// AF Game Hub — static host + Wisp relay.
//
// The school filter only ever sees this origin. Every proxied request leaves
// through the Wisp websocket upgrade at /wisp/ and is tunnelled by the local
// Node process, so Ultraviolet and Scramjet never touch the blocked hostnames
// from the browser's point of view.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { startRammerhead, isRammerheadPath } from "./rammerhead.mjs";
import { sendJson } from "./http-util.mjs";
import { handleMusic, musicHealth } from "./music.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const API_UPSTREAM = process.env.API_UPSTREAM || "";

// Rammerhead shares this origin: its rewritten URLs are absolute and its client
// refuses to initialise inside a cross-origin parent, so proxied pages are served
// from the same port as the hub. The second port is hammerhead's cross-domain
// simulation and must stay a real listener. AFHUB_RH=0 turns the engine off.
const RH_ENABLED = process.env.AFHUB_RH !== "0";
const RH_CROSS_PORT = Number(process.env.AFHUB_RH_CROSS_PORT || PORT + 1);

const rammerhead = RH_ENABLED
	? startRammerhead({
			port: PORT,
			crossPort: RH_CROSS_PORT,
			host: HOST,
			fallbackHost: "localhost",
		})
	: null;

if (RH_ENABLED && !rammerhead) {
	console.warn(`rammerhead unavailable (cross ${RH_CROSS_PORT}) — engine stays hidden`);
}

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".wasm": "application/wasm",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
};

function resolveSafe(urlPath) {
	const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
	const normalised = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
	const target = path.join(publicDir, normalised);
	if (!target.startsWith(publicDir)) return null;
	return target;
}

async function sendFile(req, res, filePath) {
	let target = filePath;
	let info;
	try {
		info = await fsp.stat(target);
	} catch {
		return false;
	}
	if (info.isDirectory()) {
		target = path.join(target, "index.html");
		try {
			info = await fsp.stat(target);
		} catch {
			return false;
		}
	}

	const ext = path.extname(target).toLowerCase();
	const vendor = /[\\/](baremux|transport|uv|scramjet)[\\/]/.test(target);
	const scriptish = [".html", ".js", ".mjs", ".css", ".webmanifest"].includes(ext);
	const headers = {
		"content-type": MIME[ext] || "application/octet-stream",
		"content-length": info.size,
		"cache-control": vendor || scriptish ? "no-cache, must-revalidate" : "public, max-age=300",
		"x-content-type-options": "nosniff",
	};

	// Proxy service workers must be allowed to claim the whole origin, not just
	// their own directory, or Scramjet can never intercept top-level navigations
	// into /scramjet/sj/.
	if (target.endsWith(`${path.sep}sw.js`)) {
		headers["service-worker-allowed"] = "/";
		headers["cache-control"] = "no-cache";
	}

	res.writeHead(200, headers);
	if (req.method === "HEAD") return res.end();
	fs.createReadStream(target).pipe(res);
	return true;
}

async function proxyApi(req, res) {
	if (!API_UPSTREAM) {
		res.writeHead(502, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: "API_UPSTREAM is not configured" }));
		return;
	}
	const upstream = new URL(req.url, API_UPSTREAM);
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const body = chunks.length ? Buffer.concat(chunks) : undefined;
	try {
		const response = await fetch(upstream, {
			method: req.method,
			headers: {
				"content-type": req.headers["content-type"] || "application/json",
			},
			body,
		});
		res.writeHead(response.status, {
			"content-type": response.headers.get("content-type") || "application/json",
			"cache-control": "no-store",
		});
		res.end(Buffer.from(await response.arrayBuffer()));
	} catch (error) {
		res.writeHead(502, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: String(error?.message || error) }));
	}
}

const server = http.createServer(async (req, res) => {
	const started = Date.now();
	const url = req.url || "/";
	const parsed = new URL(url, "http://localhost");

	// Engine discovery. /go/ builds its engine row from this, so an engine that
	// is not actually running is never offered as a choice.
	if (url === "/api/engines") {
		return sendJson(res, 200, {
			engines: {
				scramjet: { kind: "service-worker", prefix: "/scramjet/sj/" },
				ultraviolet: { kind: "service-worker", prefix: "/uv/service/" },
				rammerhead: rammerhead
					? {
							kind: "server",
							origin: rammerhead.origin(req),
							port: rammerhead.port,
							crossPort: rammerhead.crossPort,
						}
					: null,
			},
		});
	}

	// Rammerhead addresses pages as /<sessionId>/<absolute-url>, and the session
	// has to exist in the store before the first request or the page 404s. One
	// session per browser tab keeps cookies and storage separate.
	if (url === "/api/rh/session" && req.method === "POST") {
		if (!rammerhead) return sendJson(res, 503, { error: "rammerhead disabled" });
		return sendJson(res, 200, {
			id: rammerhead.createSession(),
			origin: rammerhead.origin(req),
		});
	}

	// Music and lyrics are served natively, so the hub works without a deployed
	// Cloudflare worker. Everything else under /api/ can still be forwarded.
	if (await handleMusic(req, res, parsed)) return;

	// Rammerhead pages are absolute paths on this origin, so the hub server has to
	// hand them over before static resolution — /<session>/<url> is not a file, and
	// falling through to the SPA fallback would render the hub inside the frame.
	if (rammerhead && isRammerheadPath(parsed.pathname)) {
		rammerhead.handleRequest(req, res);
		return;
	}

	if (url.startsWith("/api/")) return proxyApi(req, res);
	if (url === "/health") {
		res.writeHead(200, { "content-type": "application/json" });
		return res.end(
			JSON.stringify({
				ok: true,
				uptime: process.uptime(),
				engines: { rammerhead: Boolean(rammerhead) },
				music: musicHealth(),
			})
		);
	}

	const target = resolveSafe(url);
	if (!target) {
		res.writeHead(400, { "content-type": "text/plain" });
		return res.end("bad path");
	}

	const served = await sendFile(req, res, target);
	if (!served) {
		const fallback = path.join(publicDir, "index.html");
		if (!(await sendFile(req, res, fallback))) {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
		}
	}
	if (process.env.LOG !== "0") {
		console.log(`${req.method} ${url} ${res.statusCode} ${Date.now() - started}ms`);
	}
});

// Wisp multiplexes every stream over this single upgrade endpoint. The trailing
// slash matters: wisp-js treats a path that does not end in "/" as a websocket
// passthrough connection instead of a protocol handshake.
server.on("upgrade", (req, socket, head) => {
	const { pathname } = new URL(req.url || "/", "http://localhost");
	if (pathname.startsWith("/wisp/")) {
		wisp.routeRequest(req, socket, head);
		return;
	}
	// Proxied pages and hammerhead's message socket upgrade on their own paths
	// (/<session>/wss://host, /messaging). They belong to Rammerhead, not Wisp.
	if (rammerhead && isRammerheadPath(pathname)) {
		rammerhead.handleUpgrade(req, socket, head);
		return;
	}
	socket.destroy();
});

server.listen(PORT, HOST, () => {
	console.log(`AF Game Hub  ->  http://localhost:${PORT}/`);
	console.log(`proxy page   ->  http://localhost:${PORT}/go/`);
	console.log(`wisp relay   ->  ws://localhost:${PORT}/wisp/`);
	if (rammerhead) {
		console.log(`rammerhead   ->  same origin as the hub, cross port ${rammerhead.crossPort}`);
	} else {
		console.log("rammerhead disabled (set AFHUB_RH=0 to silence this)");
	}
	if (!API_UPSTREAM) console.log("api passthrough disabled (set API_UPSTREAM to enable /api/*)");
});

process.on("SIGINT", () => {
	console.log("\nshutting down");
	rammerhead?.close();
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 2000).unref();
});

process.on("unhandledRejection", (reason) => {
	console.error("unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
	console.error("uncaught exception:", error);
});
