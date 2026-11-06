// AF Game Hub — Rammerhead engine.
//
// Scramjet and Ultraviolet both live in a service worker. Managed school
// devices routinely ship a policy that disables service worker registration
// entirely, which takes both of them out in one stroke. Rammerhead is a
// server-side proxy: hammerhead rewrites the page on the Node side and streams
// it back, so nothing in the browser has to be trusted, registered, or allowed.
// That makes it the fallback that still works when the other two cannot.
//
// Hammerhead builds every rewritten URL from getServerInfo(), and those URLs are
// absolute (http://host:port/<session>/<url>). A path prefix cannot be
// expressed, so Rammerhead has to own whole URLs at the origin level.
//
// It shares the hub's origin and port instead of getting one of its own.
// hammerhead's client reads `window.parent['%hammerhead%'].nativeMethods` while
// it initialises, which throws SecurityError when the parent document sits on a
// different origin — and /go/ is always the parent. Two ports means every
// proxied page paints its static HTML and then dies in "hammerhead not loaded
// yet". One origin means the client installs. The hub's http.Server therefore
// forwards Rammerhead paths into proxy.server1 rather than Rammerhead binding a
// listener for them.
//
// server2 keeps a real listener on its own port: hammerhead uses it to simulate
// cross-origin requests, and folding it into the hub port would make every
// cross-origin fetch look same-origin to the proxied page.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { rammerheadClient } from "./rammerhead-client.mjs";

const require = createRequire(import.meta.url);

const RammerheadProxy = require("rammerhead/src/classes/RammerheadProxy");
const RammerheadSessionMemoryStore = require("rammerhead/src/classes/RammerheadMemoryStore");
const RammerheadLogging = require("rammerhead/src/classes/RammerheadLogging");

// Service routes hammerhead answers on the proxy origin. They are absolute paths,
// so once Rammerhead shares the hub origin these are the paths the hub server
// has to hand over instead of treating them as static files.
export const RAMMERHEAD_ROUTES = new Set([
	"/hammerhead.js",
	"/worker-hammerhead.js",
	"/transport-worker.js",
	"/task.js",
	"/iframe-task.js",
	"/messaging",
	"/rammerhead.js",
	"/api/shuffleDict",
	"/syncLocalStorage",
]);

// A proxied page is /<sessionId>/<absolute-url>. RammerheadSessionIds are our own
// 32-character hex UUIDs (see createSession), so the shape is unambiguous and
// cannot collide with a static path.
const SESSION_PATH = /^\/[0-9a-f]{32}(?:[/!]|$)/;

export function isRammerheadPath(pathname) {
	if (RAMMERHEAD_ROUTES.has(pathname)) return true;
	return SESSION_PATH.test(pathname);
}

// Hammerhead recomputes its own base URL from whatever getServerInfo returns.
// Hostname comes off the inbound request so the frame target stays reachable
// from the same machine/address the hub itself was opened from.
function requestHostname(req, fallback) {
	const raw = req?.headers?.host;
	if (!raw) return fallback;
	if (raw.startsWith("[")) return raw.slice(0, raw.indexOf("]") + 1);
	return raw.split(":")[0];
}

function stripFrameAncestors(value) {
	if (typeof value !== "string") return undefined;
	return value
		.split(";")
		.map((part) => part.trim())
		.filter((part) => part && !/^frame-ancestors\b/i.test(part))
		.join("; ");
}

/**
 * Start Rammerhead on the hub's origin.
 *
 * Returns `{ origin(req), createSession(), handleRequest(req,res), handleUpgrade(req,socket,head), close() }`,
 * or `null` when the engine is disabled or failed to start. The caller
 * advertises the engine only when a non-null value comes back, so a broken
 * Rammerhead never shows up as a button.
 */
export function startRammerhead({
	port,
	crossPort,
	host = "0.0.0.0",
	fallbackHost = "localhost",
} = {}) {
	if (!port || !crossPort || crossPort === port) return null;

	const logger = new RammerheadLogging({ logLevel: "disabled" });

	let proxy;
	try {
		proxy = new RammerheadProxy({
			logger,
			bindingAddress: host,
			port,
			crossDomainPort: crossPort,
			dontListen: true,
			ssl: null,
			getServerInfo: (req) => ({
				hostname: requestHostname(req, fallbackHost),
				port,
				// Server2 exists so hammerhead can present a second origin. It has to
				// be advertised back to the browser as a different port or the
				// cross-origin simulation collapses into same-origin requests.
				crossDomainPort: crossPort,
				protocol: "http:",
			}),
		});
	} catch (error) {
		console.error("rammerhead failed to start:", error?.message || error);
		return null;
	}

	// dontListen suppressed both binds during start(). Server1 never needs one —
	// the hub server forwards into it — but server2 must be reachable, because
	// rewritten cross-origin URLs point straight at it.
	proxy.server2.listen(crossPort, host);

	// hammerhead's service-socket route reads serverInfo.wss, and RammerheadProxy
	// rebuilds serverInfo from getServerInfo on every request, which drops it.
	// Put the right socket back so /messaging upgrades resolve instead of
	// throwing on undefined.
	const rewriteServerInfo = proxy._rewriteServerInfo.bind(proxy);
	proxy._rewriteServerInfo = (req) => {
		const info = rewriteServerInfo(req);
		info.wss = req.socket?.localPort === crossPort ? proxy.wss2 : proxy.wss1;
		return info;
	};

	const store = new RammerheadSessionMemoryStore({ logger });
	store.attachToProxy(proxy);

	// rammerhead@1.2.64's shipped client aborts on every page (see
	// rammerhead-client.mjs). Serve the patched build from the same route the
	// bundled one uses; the pipeline runs before hammerhead's own router, so
	// returning true here wins without touching the package on disk.
	const client = rammerheadClient();
	if (client.body) {
		proxy.addToOnRequestPipeline(async (req, res, _serverInfo, isRoute, isWebsocket) => {
			if (isWebsocket || req.method !== "GET") return false;
			const pathname = (req.url || "").split("?")[0];
			if (pathname !== "/rammerhead.js") return false;
			res.writeHead(200, {
				"content-type": "application/x-javascript; charset=utf-8",
				"content-length": client.body.length,
				"cache-control": "no-store",
			});
			res.end(client.body);
			return true;
		});
	} else {
		console.warn(`rammerhead client patch skipped (${client.error}) — serving stock client`);
	}

	// These rewritten pages must be embeddable inside /go/. Hammerhead's own
	// service routes deliberately leave framing headers alone, and any real site
	// that ships X-Frame-Options or CSP frame-ancestors would otherwise refuse to
	// render in the frame.
	Object.assign(proxy.rewriteServerHeaders, {
		"x-frame-options": () => undefined,
		"content-security-policy-report-only": () => undefined,
		"cross-origin-opener-policy": () => undefined,
		"cross-origin-resource-policy": () => undefined,
		"content-security-policy": stripFrameAncestors,
	});

	function origin(req) {
		const hostname = requestHostname(req, fallbackHost);
		const suffix = port === 80 ? "" : `:${port}`;
		return `http://${hostname}${suffix}`;
	}

	function createSession() {
		const id = randomUUID().replace(/-/g, "");
		store.add(id);
		return id;
	}

	function handleRequest(req, res) {
		proxy.server1.emit("request", req, res);
	}

	function handleUpgrade(req, socket, head) {
		proxy.server1.emit("upgrade", req, socket, head);
	}

	return {
		port,
		crossPort,
		origin,
		createSession,
		handleRequest,
		handleUpgrade,
		proxy,
		store,
		close() {
			try {
				store.close();
			} catch {
				/* store may not implement close */
			}
			try {
				proxy.server2?.close();
			} catch {
				/* server already gone */
			}
		},
	};
}
