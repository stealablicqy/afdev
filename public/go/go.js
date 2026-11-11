import { BareMuxConnection } from "../baremux/baremux.mjs";

// The hub is served from a CDN directory (and from the repo root in dev), so
// every asset path is derived from this module's own URL. A root-absolute
// "/uv/sw.js" only resolves when the app owns the origin; here it 404s.
const ROOT = new URL("../", import.meta.url);
const BASE_PATH = ROOT.pathname;
const asset = (relative) => new URL(relative, ROOT).href;

const UV_PREFIX = `${BASE_PATH}uv/service/`;
const SJ_PREFIX = `${BASE_PATH}scramjet/sj/`;
const SJ_FILES = {
	wasm: asset("scramjet/scramjet.wasm.wasm"),
	all: asset("scramjet/scramjet.all.js"),
	sync: asset("scramjet/scramjet.sync.js"),
};

// A static CDN cannot terminate a proxy hop, so the Wisp relay is external.
// Override per-device from Settings or localStorage when this host is filtered.
const WISP_KEY = "af.go.wisp";
const WISP_DEFAULT = "wss://anura.pro/wisp/";

// Category filters block by hostname, not by protocol. A relay on a domain that
// reads as an ordinary site survives where `wisp.<something>.dev` gets filed
// under "proxy" and dropped. These entries are tokened relays: the host mints a
// short-lived session over HTTPS and the socket carries it in `?s=`, so the
// upgrade looks like authenticated traffic to a normal site rather than an open
// relay. The token host is also the only one of these that a content filter is
// unlikely to have ever seen.
//
// Shape: `mint` returns JSON, `token` names the field, `socket` builds the URL.
const RELAY_MINTS = [
	{
		label: "desynctutoring",
		mint: "https://desynctutoring.com/api/session",
		token: "s",
		socket: (token) => `wss://desynctutoring.com/wisp/?s=${encodeURIComponent(token)}`,
	},
];

// Public relays come and go, and a stale default is the difference between a
// working proxy and a dead one. Probed in order after the primary refuses; the
// first socket that opens becomes the runtime relay and is remembered for the tab.
// Measured 2026-11-06: anura is the only entry in this pool that completes a
// handshake. The rest are kept as cheap probes because these hosts rotate back
// online without notice, and a dead probe costs one timeout, not a session.
const WISP_FALLBACKS = [
	"wss://wisp.mercurywork.shop/",
	"wss://wisp.egg.lol/",
	"wss://wisp.birdcat.cafe/",
	"wss://wisp.hydroxide.dev/",
	"wss://wisp.quartz.rip/",
	"wss://wisp.rhodes.rip/",
];

function readWispUrl() {
	let stored = "";
	try {
		stored = localStorage.getItem(WISP_KEY) || "";
	} catch {
		// private mode / blocked storage: fall back to the default relay
	}
	return /^wss?:\/\//i.test(stored) ? stored : WISP_DEFAULT;
}

function hasWispOverride() {
	try {
		return /^wss?:\/\//i.test(localStorage.getItem(WISP_KEY) || "");
	} catch {
		return false;
	}
}

let WISP_URL = readWispUrl();
// Set when a probe rotated off a dead primary, so initTransport and re-seats keep
// using the relay that actually answered instead of re-reading the dead default.
let WISP_ROTATED = "";
// The mint entry currently carrying the session, when one is. Kept so every
// re-seat re-mints instead of replaying an expired token.
let RELAY_ACTIVE = null;

function activeWispUrl() {
	return WISP_ROTATED || readWispUrl();
}

// Tokens are timestamped and short-lived, so they are minted per call site
// rather than cached. One small GET; a blocked host fails fast and the caller
// falls through to the public pool.
//
// The mint host drops requests that arrive without a Referer. This document sets
// `meta[name=referrer]` to `no-referrer` for cloak reasons, which would strip it
// on every one of these calls, so each attempt overrides the policy explicitly.
// A plain http page cannot send a Referer to an https target at all, which is why
// this only resolves once the hub is served over https.
const MINT_POLICIES = ["origin", undefined, "unsafe-url"];

async function mintRelayUrl(only = null) {
	const entries = only ? [only] : RELAY_MINTS;
	for (const entry of entries) {
		for (const referrerPolicy of MINT_POLICIES) {
			try {
				const response = await fetch(entry.mint, {
					credentials: "same-origin",
					cache: "no-store",
					...(referrerPolicy ? { referrerPolicy } : {}),
				});
				if (!response.ok) continue;
				const body = await response.json();
				const token = body?.[entry.token];
				if (typeof token === "string" && token.length > 8) return { entry, url: entry.socket(token) };
			} catch (error) {
				console.warn(`relay mint ${entry.label} failed:`, error?.message || error);
				break;
			}
		}
	}
	return null;
}

// A Settings override names a host, not a credential. If the host happens to be
// a tokened relay, the stored URL still needs a live token or the socket refuses
// the upgrade — so the entry is recovered by host and re-minted like any other.
function relayEntryFor(url) {
	let host = "";
	try {
		host = new URL(url).host;
	} catch {
		return null;
	}
	for (const entry of RELAY_MINTS) {
		try {
			if (new URL(entry.socket("probe")).host === host) return entry;
		} catch {
			// malformed entry: skip
		}
	}
	return null;
}

// The health record is rendered in the drawer and copied into support posts, so
// the session token never travels with it.
function relayDisplay(url) {
	try {
		const parsed = new URL(url);
		return parsed.origin + parsed.pathname;
	} catch {
		return url;
	}
}

// Bump when the bare-mux worker changes: the browser caches SharedWorker scripts
// by URL, and a stale one breaks every transport with an importScripts error.
const BAREMUX_WORKER = `${asset("baremux/worker.js")}?v=5`;
const TRANSPORT_URL = asset("transport/epoxy.mjs");

// How long a frame gets to announce itself before the ladder moves on. Schools
// drop blocked requests silently, so "no load event" is the common failure, not
// an error page.
const LOAD_TIMEOUT = 14000;
const RECONCILE_MS = 400;

// A load event is not proof of a render: a proxy can hand back its own error
// page and fire the event on that. After a load the frame body is inspected at
// these offsets before the engine is trusted, so a blank/refused page fails over
// instead of parking the chip on "ready".
const VERIFY_DELAYS = [250, 900];

const ERROR_MARKERS = [
	"err_name_not_resolved",
	"err_connection_refused",
	"err_connection_reset",
	"err_connection_closed",
	"err_internet_disconnected",
	"err_tunnel_connection_failed",
	"err_ssl_protocol_error",
	"err_cert_",
	"err_address_unreachable",
	"err_timed_out",
	"err_empty_response",
	"err_blocked_by_client",
	"site can't be reached",
	"site can’t be reached",
	"took too long to respond",
	"refused to connect",
	"there was an error loading",
	"error processing your request",
	"failed to load http",
	"scramjet encountered an error",
	"ultraviolet was unable to",
	"proxy failed",
	"bad gateway",
];

// Every proxy ships its own failed-request shell, and each one names itself in
// the document title. A real site whose title happens to be "Scramjet" is not a
// thing; a proxy error page that happens to be 441 characters long is the
// common case. The title check runs before any length shortcut so a long error
// page is never scored as a render.
const PROXY_SHELL_TITLES = ["scramjet", "ultraviolet", "rammerhead", "uv"];

// Site memory survives a reload: which engine rendered a host last time, and
// which ones it already refused. Wiped from the diagnostics drawer.
const MEMORY_KEY = "af.go.memory.v1";
const RECENT_KEY = "af.go.recent.v1";

// Rammerhead is a server-side proxy: it needs a session minted by a backend it
// shares an origin with. That backend is server/index.mjs, discovered through
// /api/engines when the hub is hosted on it. A remote Rammerhead server can be
// set per device from Settings, which is the only way the lane exists on a
// static CDN host. The lane hides itself when neither answers.
const RH_KEY = "af.go.rh";

function readRhBase() {
	let stored = "";
	try {
		stored = localStorage.getItem(RH_KEY) || "";
	} catch {
		// storage blocked: no remote lane, same-origin discovery still applies
	}
	return /^https?:\/\//i.test(stored) ? stored.replace(/\/+$/, "") : "";
}

let RH_BASE = readRhBase();

const ENGINE_ORDER = ["ultraviolet", "rammerhead", "scramjet"];
const ENGINE_LABEL = {
	scramjet: "Scramjet",
	ultraviolet: "Ultraviolet",
	rammerhead: "Rammerhead",
};

// `!sj site.com` forces a lane for one navigation. Shorthand resolves to the
// same table the engine buttons use.
const ENGINE_ALIAS = {
	sj: "scramjet",
	scram: "scramjet",
	scramjet: "scramjet",
	uv: "ultraviolet",
	ultra: "ultraviolet",
	ultraviolet: "ultraviolet",
	rh: "rammerhead",
	rhm: "rammerhead",
	rammerhead: "rammerhead",
	auto: null,
};

const QUICK_LINKS = [
	{ label: "YouTube", url: "https://www.youtube.com", note: "video" },
	{ label: "Discord", url: "https://discord.com/app", note: "chat" },
	{ label: "Reddit", url: "https://www.reddit.com", note: "forum" },
	{ label: "Twitch", url: "https://www.twitch.tv", note: "live" },
	{ label: "Spotify", url: "https://open.spotify.com", note: "music" },
	{ label: "TikTok", url: "https://www.tiktok.com", note: "clips" },
	{ label: "Coolmath", url: "https://www.coolmathgames.com", note: "games" },
	{ label: "GitHub", url: "https://github.com", note: "code" },
];

const dom = {
	stage: document.getElementById("stage"),
	home: document.getElementById("home"),
	homeGrid: document.getElementById("homeGrid"),
	homeSearch: document.getElementById("homeSearch"),
	homeInput: document.getElementById("homeInput"),
	homeEngine: document.getElementById("homeEngine"),
	omnibox: document.getElementById("omnibox"),
	address: document.getElementById("address"),
	back: document.getElementById("back"),
	forward: document.getElementById("forward"),
	reload: document.getElementById("reload"),
	homeBtn: document.getElementById("homeBtn"),
	newTab: document.getElementById("newTab"),
	tabstrip: document.getElementById("tabstrip"),
	status: document.getElementById("status"),
	statusText: document.getElementById("statusText"),
	loadbar: document.getElementById("loadbar"),
	engine: document.getElementById("engine"),
	engineNote: document.getElementById("engineNote"),
	openTab: document.getElementById("openTab"),
	cloakBtn: document.getElementById("cloakBtn"),
	cloakMenu: document.getElementById("cloakMenu"),
	cloakList: document.getElementById("cloakList"),
	cloakPanic: document.getElementById("cloakPanic"),
	cloakAuto: document.getElementById("cloakAuto"),
	stealthBtn: document.getElementById("stealthBtn"),
	popoutBtn: document.getElementById("popoutBtn"),
	diagBtn: document.getElementById("diagBtn"),
	drawer: document.getElementById("drawer"),
	drawerBody: document.getElementById("drawerBody"),
	drawerClose: document.getElementById("drawerClose"),
	diagProbe: document.getElementById("diagProbe"),
	diagForget: document.getElementById("diagForget"),
	diagCopy: document.getElementById("diagCopy"),
	toasts: document.getElementById("toasts"),
	homeRecent: document.getElementById("homeRecent"),
};

const state = {
	tabs: [],
	active: -1,
	engine: "ultraviolet",
	controller: null,
	connection: null,
	transport: "",
	booted: false,
	nextTabId: 1,
	rammerhead: null,
	engines: { scramjet: false, ultraviolet: false },
	siteEngine: Object.create(null),
	siteFail: Object.create(null),
	health: Object.create(null),
	recent: [],
	lastError: "",
	autoCloaked: null,
};

/* ------------------------------------------------------------------ utils */

function setStatus(text, mode) {
	dom.statusText.textContent = text;
	dom.status.dataset.state = mode || "idle";
}

function normaliseInput(raw) {
	const value = String(raw || "").trim();
	if (!value) return null;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
	if (/^about:blank$/i.test(value)) return "about:blank";
	const looksLikeHost = /^[^\s/]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(value);
	if (looksLikeHost) return `https://${value}`;
	return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

function safeHost(url) {
	try {
		return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return "";
	}
}

function hostOf(url) {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "new tab";
	}
}

function activeTab() {
	return state.tabs[state.active] || null;
}

function toast(message) {
	const node = document.createElement("div");
	node.className = "toast";
	node.textContent = message;
	dom.toasts.appendChild(node);
	setTimeout(() => {
		node.classList.add("is-out");
		setTimeout(() => node.remove(), 260);
	}, 2200);
}

/* --------------------------------------------------------- stealth links */

// Stealth links carry the destination in the fragment: /go/#<base64url>. The
// fragment is never sent to the server, so a school log that records requests
// sees only /go/ — the site name appears nowhere in the URL until the page has
// already booted and decoded it locally.
function base64UrlEncode(text) {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

function stealthUrl(url) {
	return `${location.origin}/go/#${base64UrlEncode(url)}`;
}

function readStealthHash() {
	const hash = location.hash.replace(/^#/, "");
	if (!hash) return null;
	try {
		const decoded = base64UrlDecode(hash);
		if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(decoded)) return null;
		return decoded;
	} catch {
		return null;
	}
}

// `!sj youtube.com` / `!uv` / `!rh` / `!auto`. The prefix is consumed before the
// rest of the input is normalised, so the omnibox takes one grammar only.
function parseCommand(raw) {
	const value = String(raw || "").trim();
	const match = /^!([a-z]+)\s+(.+)$/i.exec(value);
	if (!match) return { url: value, engine: null, explicit: false };
	const key = match[1].toLowerCase();
	if (!(key in ENGINE_ALIAS)) return { url: value, engine: null, explicit: false };
	return { url: match[2].trim(), engine: ENGINE_ALIAS[key], explicit: true };
}

/* ------------------------------------------------------- memory + recents */

function loadMemory() {
	try {
		const stored = JSON.parse(localStorage.getItem(MEMORY_KEY) || "{}");
		for (const [host, engine] of Object.entries(stored.siteEngine || {})) {
			if (ENGINE_LABEL[engine]) state.siteEngine[host] = engine;
		}
		for (const [host, list] of Object.entries(stored.siteFail || {})) {
			if (Array.isArray(list)) state.siteFail[host] = list.filter((e) => ENGINE_LABEL[e]);
		}
	} catch {
		// Corrupt memory is not worth recovering from: a wrong engine costs one
		// failed load, a parse loop costs the page.
	}
	try {
		const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
		if (Array.isArray(recent)) state.recent = recent.filter((u) => typeof u === "string").slice(0, 8);
	} catch {
		state.recent = [];
	}
}

let memoryTimer = null;
function saveMemory() {
	clearTimeout(memoryTimer);
	memoryTimer = setTimeout(() => {
		try {
			localStorage.setItem(
				MEMORY_KEY,
				JSON.stringify({ siteEngine: state.siteEngine, siteFail: state.siteFail })
			);
		} catch {
			// Quota or private mode: memory is an optimisation, not a requirement.
		}
	}, 250);
}

function rememberVisit(url) {
	if (!url || url === "about:blank") return;
	state.recent = [url, ...state.recent.filter((entry) => entry !== url)].slice(0, 8);
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent));
	} catch {
		// Same story as saveMemory.
	}
	renderRecent();
}

function forgetMemory() {
	state.siteEngine = Object.create(null);
	state.siteFail = Object.create(null);
	try {
		localStorage.removeItem(MEMORY_KEY);
	} catch {
		// ignore
	}
	renderDrawer();
	toast("engine memory cleared");
}

/* ---------------------------------------------------------------- engines */

function isEngineUsable(engine) {
	if (engine === "rammerhead") return Boolean(state.rammerhead?.origin || RH_BASE);
	return Boolean(state.engines[engine]);
}

// A dead lane is demoted, never deleted: if a probe is wrong or the network
// changed five minutes ago, the engine is still reachable at the bottom of the
// ladder rather than missing from it.
function engineRank(engine) {
	const verdict = state.health[engine]?.state;
	if (verdict === "ok") return 0;
	if (verdict === "bad") return 2;
	return 1;
}

function orderedEngines() {
	return ENGINE_ORDER.filter(isEngineUsable).sort((a, b) => engineRank(a) - engineRank(b));
}

function firstUsableEngine() {
	return orderedEngines()[0] || "ultraviolet";
}

// Engine choice is remembered per host: a site that only renders through one
// engine should keep using it on every later visit, including new tabs.
function engineFor(url) {
	const host = safeHost(url);
	const failed = host ? state.siteFail[host] || [] : [];

	if (host) {
		const remembered = state.siteEngine[host];
		if (remembered && isEngineUsable(remembered) && !failed.includes(remembered)) {
			return remembered;
		}
	}

	for (const engine of orderedEngines()) {
		if (failed.includes(engine)) continue;
		return engine;
	}
	return firstUsableEngine();
}

function proxyUrl(tab, url) {
	if (tab.engine === "scramjet") return SJ_PREFIX + encodeURIComponent(url);
	if (tab.engine === "ultraviolet") {
		return UV_PREFIX + globalThis.Ultraviolet.codec.xor.encode(url);
	}
	if (tab.engine === "rammerhead") {
		// A remote server mints its own session from the bare URL form and
		// redirects into it, so no cross-origin session call is needed.
		const base = tab.rhSession?.origin || RH_BASE;
		if (!base) return null;
		if (tab.rhSession?.id) return `${base}/${tab.rhSession.id}/${url}`;
		return `${base}/${url}`;
	}
	return null;
}

// Same-origin Rammerhead (server/index.mjs) hands out a session id; a remote
// server does not need one, because it redirects into a session on first load.
async function ensureRammerheadSession(tab) {
	if (tab.rhSession || RH_BASE) {
		if (!tab.rhSession && RH_BASE) tab.rhSession = { origin: RH_BASE, id: "" };
		return tab.rhSession;
	}
	const response = await fetch(new URL("api/rh/session", ROOT).href, {
		method: "POST",
		cache: "no-store",
	});
	if (!response.ok) throw new Error(`session ${response.status}`);
	const data = await response.json();
	if (!data?.id || !data?.origin) throw new Error("session payload incomplete");
	tab.rhSession = { id: data.id, origin: data.origin };
	return tab.rhSession;
}

// The hub server advertises which lanes it can actually run. Absent, the two
// service-worker engines are still available, so this never blocks boot.
async function discoverEngines() {
	RH_BASE = readRhBase();
	try {
		const response = await fetch(new URL("api/engines", ROOT).href, { cache: "no-store" });
		if (!response.ok) return;
		const data = await response.json();
		const rammerhead = data?.engines?.rammerhead;
		if (rammerhead?.origin) {
			state.rammerhead = { origin: String(rammerhead.origin).replace(/\/+$/, "") };
			mark("rammerhead:available");
		}
	} catch (error) {
		console.debug("engine discovery skipped:", error?.message || error);
	}
}

/* ---------------------------------------------------------------- probes */

// Proof of paint. A proxy can answer with its own error page and still fire a
// load event, so the frame body is read after the event: a document with no
// text and no media is a blank, and a short document that names a network
// failure is the filter, not the site.
function inspectFrame(frame) {
	let doc = null;
	try {
		doc = frame.contentDocument;
	} catch {
		return "unknown";
	}
	if (!doc?.location) return "unknown";
	// A frame that has not committed a navigation yet is still about:blank. That
	// is "waiting", not "blank", or every slow first paint would trip failover.
	if (doc.location.href === "about:blank") return "pending";
	// Still parsing: the body can legitimately be empty at this instant.
	if (doc.readyState === "loading") return "pending";

	let text = "";
	try {
		text = (doc.body?.innerText || doc.documentElement?.textContent || "")
			.replace(/\s+/g, " ")
			.trim();
	} catch {
		return "unknown";
	}

	// The proxy's own failure shell: it fires a load event like any page and can
	// carry plenty of text, so length proves nothing here.
	const title = (doc.title || "").trim().toLowerCase();
	if (PROXY_SHELL_TITLES.includes(title)) return "error";

	const rich = Boolean(
		doc.body?.querySelector("img,video,canvas,iframe,svg,form,table,ul,ol,input,button,a[href]")
	);
	if (text.length < 4 && !rich) return "blank";

	// Markers are checked against the whole document, not just short ones: a
	// proxy error page that includes a stack trace or a help section is still an
	// error page.
	const lower = text.toLowerCase();
	if (ERROR_MARKERS.some((marker) => lower.includes(marker))) return "error";

	if (text.length > 400) return "ok";
	if (text.length < 24 && !rich) return "blank";
	return "ok";
}

// Probing a proxy with a throwaway iframe is worse than no probe: tearing the
// frame down mid-flight leaves Scramjet's worker without a client binding and
// wedges the very lane it was measuring, so a healthy engine gets marked dead
// and demoted for every later navigation. Health is read from what is already
// true instead — the transport, the controller, the worker registrations, the
// Wisp socket, and the verdict of real navigations — none of which disturbs a
// lane.
function healthVerdict(engine, verdict, note) {
	const previous = state.health[engine];
	state.health[engine] = {
		state: verdict,
		note: note || "",
		ms: previous?.ms || 0,
		at: Date.now(),
	};
}

async function probeEngine(engine) {
	const started = performance.now();
	const took = () => Math.round(performance.now() - started);

	if (!isEngineUsable(engine)) {
		return { state: "bad", note: "not registered", ms: 0, at: Date.now() };
	}

	if (engine === "scramjet") {
		if (!state.controller) {
			return { state: "bad", note: "controller not ready", ms: took(), at: Date.now() };
		}
		return { state: "ok", note: "controller ready", ms: took(), at: Date.now() };
	}

	// Rammerhead answers a HEAD on its own origin. A remote server that is not
	// reachable is still a configured lane, so the note names which case it is.
	if (engine === "rammerhead") {
		const base = state.rammerhead?.origin || RH_BASE;
		if (!base) {
			return { state: "bad", note: "no server", ms: took(), at: Date.now() };
		}
		try {
			await withTimeout(fetch(`${base}/`, { method: "HEAD", mode: "no-cors" }), 6000, "rh probe");
			return { state: "ok", note: "server answers", ms: took(), at: Date.now() };
		} catch {
			return { state: "bad", note: "server unreachable", ms: took(), at: Date.now() };
		}
	}

	// Ultraviolet is a service worker plus its engine script. A registration that
	// is still installing cannot serve anything yet, so it reads as not ready
	// rather than as a dead lane.
	if (!state.engines.ultraviolet) {
		return { state: "bad", note: "engine not registered", ms: took(), at: Date.now() };
	}
	const workers = await swReport();
	const scope = workers.find((entry) => entry.scope === UV_PREFIX);
	if (!scope?.active) {
		return {
			state: "bad",
			note: scope ? "worker installing" : "no worker",
			ms: took(),
			at: Date.now(),
		};
	}
	return { state: "ok", note: "worker active", ms: took(), at: Date.now() };
}

async function probeAllEngines() {
	const targets = ENGINE_ORDER.filter(isEngineUsable);
	renderDrawer();
	const settled = await Promise.allSettled(
		targets.map(async (engine) => [engine, await probeEngine(engine)])
	);
	for (const result of settled) {
		if (result.status !== "fulfilled") continue;
		const [engine, verdict] = result.value;
		state.health[engine] = verdict;
	}
	renderDrawer();
	return state.health;
}

// Wisp is the socket under both service-worker engines. If the school blocks
// websockets, the two SW lanes are dead on arrival and Rammerhead is the only
// thing that can work — worth knowing before a user blames the site.
function probeWisp() {
	return new Promise((resolve) => {
		const started = performance.now();
		let socket = null;
		let settled = false;
		const done = (ok, note) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				socket?.close();
			} catch {
				// already closed
			}
			const verdict = { state: ok ? "ok" : "bad", ms: Math.round(performance.now() - started), note: note || "", at: Date.now(), url: WISP_URL };
			state.health.wisp = verdict;
			resolve(verdict);
		};
		const timer = setTimeout(() => done(false, "handshake timeout"), 4000);
		try {
			socket = new WebSocket(WISP_URL);
		} catch (error) {
			return done(false, String(error?.message || error));
		}
		socket.addEventListener("open", () => done(true, "socket open"));
		socket.addEventListener("error", () => done(false, "socket refused"));
	});
}

// A refused primary is not a dead proxy: rotate through the tokened relays and
// then the public pool, keeping the first one that completes a handshake. Only a
// user-set relay is respected verbatim, so a Settings override never gets
// silently swapped.
async function resolveWisp() {
	if (!hasWispOverride()) {
		const minted = await mintRelayUrl();
		if (minted) {
			const probe = await probeWispAt(minted.url);
			if (probe.state === "ok") {
				WISP_URL = minted.url;
				WISP_ROTATED = minted.url;
				RELAY_ACTIVE = minted.entry;
				state.health.wisp = { ...probe, url: relayDisplay(minted.url), note: `tokened relay ${minted.entry.label}` };
				renderDrawer();
				return state.health.wisp;
			}
		}
	}

	const verdict = await probeWisp();
	if (verdict.state === "ok") return verdict;

	if (hasWispOverride()) return verdict;

	for (const relay of WISP_FALLBACKS) {
		const probe = await probeWispAt(relay);
		if (probe.state === "ok") {
			WISP_URL = relay;
			WISP_ROTATED = relay;
			state.health.wisp = { ...probe, url: relay, note: "rotated to " + new URL(relay).host };
			renderDrawer();
			return state.health.wisp;
		}
	}
	return verdict;
}

// Sequential probing cost one full handshake timeout per dead host, so a pool
// with five dead entries stalled boot for half a minute before the transport
// even started. Racing them costs a single timeout and keeps the fastest relay.
async function resolveWispFast() {
	// Tokened relay first, and awaited rather than raced: it is one HTTPS round
	// trip against a host the filter has no reason to have categorised, and a
	// public wisp pool will lose the race on a filtered network anyway.
	if (!hasWispOverride()) {
		const minted = await mintRelayUrl();
		if (minted) {
			const probe = await probeWispAt(minted.url);
			if (probe.state === "ok") {
				WISP_URL = minted.url;
				WISP_ROTATED = minted.url;
				RELAY_ACTIVE = minted.entry;
				state.health.wisp = { ...probe, url: relayDisplay(minted.url), note: `tokened relay ${minted.entry.label}` };
				renderDrawer();
				return state.health.wisp;
			}
		}
	}

	const primary = await probeWisp();
	if (primary.state === "ok") return primary;

	if (hasWispOverride()) return primary;

	const probes = await Promise.all(WISP_FALLBACKS.map((relay) => probeWispAt(relay).then((p) => ({ relay, ...p }))));
	const winner = probes.filter((p) => p.state === "ok").sort((a, b) => a.ms - b.ms)[0];
	if (!winner) return primary;

	WISP_URL = winner.relay;
	WISP_ROTATED = winner.relay;
	state.health.wisp = { state: "ok", ms: winner.ms, at: winner.at, url: winner.relay, note: "rotated to " + new URL(winner.relay).host };
	renderDrawer();
	return state.health.wisp;
}

function probeWispAt(url) {
	return new Promise((resolve) => {
		const started = performance.now();
		let socket = null;
		let settled = false;
		const done = (ok, note) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				socket?.close();
			} catch {
				// already closed
			}
			resolve({ state: ok ? "ok" : "bad", ms: Math.round(performance.now() - started), note: note || "", at: Date.now() });
		};
		const timer = setTimeout(() => done(false, "handshake timeout"), 4000);
		try {
			socket = new WebSocket(url);
		} catch (error) {
			return done(false, String(error?.message || error));
		}
		socket.addEventListener("open", () => done(true, "socket open"));
		socket.addEventListener("error", () => done(false, "socket refused"));
	});
}

async function swReport() {
	if (!navigator.serviceWorker?.getRegistrations) return [];
	try {
		const list = await navigator.serviceWorker.getRegistrations();
		return list.map((registration) => ({
			scope: new URL(registration.scope).pathname,
			active: Boolean(registration.active),
			waiting: Boolean(registration.waiting),
			installing: Boolean(registration.installing),
		}));
	} catch {
		return [];
	}
}

/* -------------------------------------------------------------- transport */

function mark(name) {
	(globalThis.__afBoot ||= []).push(`${Math.round(performance.now())}ms ${name}`);
}

function withTimeout(promise, ms, label) {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
		),
	]);
}

async function initTransport() {
	// The transport module is a 1.7 MB import that the bare-mux worker pulls on
	// demand. Firing setTransport while the document is still fetching its own
	// assets loses the worker's reply often enough to be worth a retry, and a
	// cache-busted worker path is the only way to get a fresh SharedWorker.
	const attempts = [BAREMUX_WORKER, `${BAREMUX_WORKER}&retry=${Date.now()}`];
	// A tokened relay expires: the token carries its mint timestamp. Every seat,
	// including a re-seat after a dropped socket, trades it for a fresh one so a
	// long-lived tab does not come back to a relay that rejects its credential.
	// The same rule applies to a tokened Settings override, which names a host but
	// carries a token that was minted whenever the user pasted it.
	const relay = RELAY_ACTIVE || relayEntryFor(activeWispUrl());
	if (relay) {
		const fresh = await mintRelayUrl(relay);
		if (fresh) {
			WISP_URL = fresh.url;
			WISP_ROTATED = fresh.url;
			RELAY_ACTIVE = fresh.entry;
		} else {
			// Mint host unreachable this time: stop replaying a token that is now
			// stale and let the public pool carry the seat.
			RELAY_ACTIVE = null;
			WISP_ROTATED = "";
		}
	}
	WISP_URL = activeWispUrl();
	let lastError = null;

	for (const workerPath of attempts) {
		try {
			state.connection = new BareMuxConnection(workerPath);
			mark("baremux:connection");
			await withTimeout(
				state.connection.setTransport(TRANSPORT_URL, [{ wisp: WISP_URL }]),
				12000,
				"setTransport"
			);
			mark("baremux:set");
			const used = await withTimeout(state.connection.getTransport(), 5000, "getTransport");
			mark("baremux:get " + used);
			return used;
		} catch (error) {
			lastError = error;
			console.warn("transport attempt failed:", error?.message || error);
		}
	}

	throw lastError || new Error("transport unavailable");
}

// One transport, several engines. Each lane claims its own client binding on
// the bare-mux worker when it boots, so moving a navigation from one lane to
// another has to land on a freshly seated worker or the new engine inherits a
// binding that belongs to the old one. Concurrent callers share one re-seat.
let reseatPromise = null;
function reseatTransport() {
	if (reseatPromise) return reseatPromise;
	reseatPromise = initTransport().then(
		(used) => {
			state.transport = used;
			reseatPromise = null;
			return used;
		},
		(error) => {
			reseatPromise = null;
			throw error;
		}
	);
	return reseatPromise;
}

// Scramjet stores its scratch state in IndexedDB under "$scramjet" version 1.
//
// IndexedDB serialises requests per origin. A deleteDatabase() blocked by a
// live connection never completes, and every open() issued afterwards queues
// behind it and fires no event at all — not error, not blocked, nothing. The
// previous recovery path deleted the database whenever init() threw, which is
// how one blocked delete turned into an origin where Scramjet could never boot
// again: the controller awaited an open() that had no event left to fire.
//
// Recovery is read-first now. The stores are inspected, and the database is
// only removed when they are genuinely missing — after the Scramjet worker is
// unregistered, because an idle worker holding a connection is the usual
// blocker. init() is also time-boxed: a lane that cannot open storage must cost
// one engine, never the whole boot.
const SJ_DB = "$scramjet";
const SJ_DB_VERSION = 1;
const SJ_DB_STORES = [
	"config",
	"cookies",
	"redirectTrackers",
	"referrerPolicies",
	"publicSuffixList",
];
const SJ_STORAGE_TIMEOUT = 4000;
const SJ_INIT_TIMEOUT = 6000;

function readDatabaseStores(name, version) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, version);
		request.onsuccess = () => {
			const db = request.result;
			const stores = Array.from(db.objectStoreNames);
			db.close();
			resolve(stores);
		};
		request.onerror = () => reject(request.error || new Error("indexeddb open failed"));
		request.onblocked = () => reject(new Error("indexeddb open blocked"));
	});
}

// Once queued, a deleteDatabase() request cannot be cancelled: resolving early
// here only stops this function waiting, it does not unblock the origin. That is
// why the caller checks the store list first and never deletes speculatively.
function dropDatabase(name) {
	return new Promise((resolve) => {
		const request = indexedDB.deleteDatabase(name);
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		request.onsuccess = () => finish(true);
		request.onerror = () => finish(false);
		request.onblocked = () => finish(false);
		setTimeout(() => finish(false), 4000);
	});
}

async function releaseScramjetWorker() {
	try {
		const registrations = await navigator.serviceWorker.getRegistrations();
		await Promise.all(
			registrations
				.filter((entry) => entry.scope.endsWith(SJ_PREFIX))
				.map((entry) => entry.unregister())
		);
	} catch {
		// No service worker API means no worker can be holding a connection.
	}
}

async function ensureScramjetDatabase() {
	const stores = await readDatabaseStores(SJ_DB, SJ_DB_VERSION);
	if (SJ_DB_STORES.every((store) => stores.includes(store))) return;
	console.warn("scramjet database is missing stores:", stores.join(",") || "none");
	await releaseScramjetWorker();
	await dropDatabase(SJ_DB);
}

async function initScramjet() {
	if (state.controller) return state.controller;
	await new Promise((resolve, reject) => {
		if (globalThis.$scramjetLoadController) return resolve();
		const script = document.createElement("script");
		script.src = SJ_FILES.all;
		script.onload = resolve;
		script.onerror = () => reject(new Error("scramjet bundle failed to load"));
		document.head.appendChild(script);
	});
	const { ScramjetController } = globalThis.$scramjetLoadController();
	const build = () =>
		new ScramjetController({
			prefix: SJ_PREFIX,
			files: SJ_FILES,
			flags: {
				serviceworkers: false,
				syncxhr: false,
				strictRewrites: true,
				rewriterLogs: false,
				captureErrors: true,
				cleanErrors: false,
				scramitize: false,
				sourcemaps: true,
				destructureRewrites: false,
				interceptDownloads: false,
				allowInvalidJs: true,
				allowFailedIntercepts: true,
			},
		});

	// The storage check is an optimisation: when it cannot answer in time the
	// controller still gets a chance, because a healthy database never needs it.
	await withTimeout(ensureScramjetDatabase(), SJ_STORAGE_TIMEOUT, "scramjet storage").catch(
		(error) => {
			console.warn("scramjet storage check skipped:", error?.message || error);
		}
	);

	const controller = build();
	await withTimeout(controller.init(), SJ_INIT_TIMEOUT, "scramjet init");
	state.controller = controller;
	return controller;
}

// A registration that resolves is not a worker that can serve: the install has
// to reach "activated" before the scope answers fetches. The first attempt
// happens while the document is still settling and can lose its install, so
// every lane is retried until it reports an activated worker.
const WORKER_TARGETS = [
	{ engine: "ultraviolet", script: () => asset("uv/sw.js"), scope: () => UV_PREFIX },
	{ engine: "scramjet", script: () => asset("scramjet/sw.js"), scope: () => SJ_PREFIX },
];

async function activeWorkerFor(scope) {
	const workers = await swReport();
	const entry = workers.find((item) => item.scope === scope);
	return entry?.active ? entry.active : "";
}

async function claimWorker({ engine, script, scope }, attempts) {
	const scopePath = scope();
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const registration = await navigator.serviceWorker.register(script(), {
				scope: scopePath,
				updateViaCache: "none",
			});
			const installer = registration.installing || registration.waiting;
			if (installer && !registration.active) {
				await new Promise((resolve) => {
					const timer = setTimeout(resolve, 6000);
					installer.addEventListener("statechange", () => {
						if (installer.state === "activated" || installer.state === "redundant") {
							clearTimeout(timer);
							resolve();
						}
					});
				});
			}
			if (await activeWorkerFor(scopePath)) return true;
		} catch (error) {
			// A failed install is retried: the second attempt runs after the
			// document has settled, which is when the install actually lands.
			console.warn(`${engine} sw attempt ${attempt} failed:`, error?.message || error);
		}
		await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
	}
	const active = await activeWorkerFor(scopePath);
	if (!active) console.warn(`${engine} sw never activated`);
	return Boolean(active);
}

async function registerWorkers() {
	const results = await Promise.all(WORKER_TARGETS.map((target) => claimWorker(target, 3)));
	WORKER_TARGETS.forEach((target, index) => {
		state.engines[target.engine] = results[index];
	});
	return results;
}

/* ------------------------------------------------------------------- tabs */

function armWatchdog(tab) {
	clearTimeout(tab.watchdog);
	tab.loadStarted = Date.now();
	tab.watchdog = setTimeout(() => {
		if (!tab.loading) return;
		// A filter that drops the first request of a burst usually lets the
		// second through. One silent re-issue costs nothing and saves a full
		// engine swap on the common case.
		if (!tab.retries && tab.url) {
			tab.retries = 1;
			applySource(tab, tab.url);
			armWatchdog(tab);
			return;
		}
		failover(tab, "timeout");
	}, LOAD_TIMEOUT);
}

function applySource(tab, url) {
	const target = proxyUrl(tab, url);
	tab.loadToken = (tab.loadToken || 0) + 1;

	if (tab.engine === "scramjet") {
		if (!tab.sjFrame) attachFrame(tab);
		if (tab.sjFrame) {
			tab.sjFrame.go(url);
			return;
		}
	}

	if (!target) {
		finishLoad(tab);
		return;
	}
	tab.frame.src = target;
}

function loadInTab(tab, url, options) {
	const opts = options || {};
	if (!url) return;
	const previousEngine = tab.engine;
	tab.loading = true;
	tab.retries = 0;
	dom.loadbar.classList.remove("is-done");
	dom.loadbar.classList.add("is-loading");
	dom.loadbar.firstElementChild.style.width = "35%";
	setStatus("loading", "busy");
	renderTabs();

	if (!opts.keepHistory) {
		tab.history = tab.history.slice(0, tab.index + 1);
		if (tab.history[tab.history.length - 1] !== url) tab.history.push(url);
		tab.index = tab.history.length - 1;
	}

	if (url === "about:blank") {
		tab.url = "";
		finishLoad(tab);
		return;
	}

	tab.url = url;
	if (opts.forceEngine && isEngineUsable(opts.forceEngine)) tab.engine = opts.forceEngine;
	else if (tab.manualEngine && isEngineUsable(tab.manualEngine)) tab.engine = tab.manualEngine;
	else tab.engine = engineFor(url);
	renderChrome();
	rememberVisit(url);

	const run = () => {
		if (tab.engine === "rammerhead" && !tab.rhSession) {
			armWatchdog(tab);
			ensureRammerheadSession(tab)
				.then(() => {
					if (tab.url !== url || tab.engine !== "rammerhead") return;
					applySource(tab, url);
				})
				.catch((error) => {
					console.warn("rammerhead session failed:", error?.message || error);
					failover(tab, "session");
				});
			return;
		}
		applySource(tab, url);
		armWatchdog(tab);
	};

	// Moving this navigation onto a different lane: hand the shared transport
	// over first, or the new engine inherits the old one's client binding and
	// never commits its first frame.
	if (previousEngine && previousEngine !== tab.engine) {
		reseatTransport().then(run, (error) => {
			console.warn("transport re-seat failed:", error?.message || error);
			run();
		});
		return;
	}

	run();
}

function finishLoad(tab) {
	clearTimeout(tab.watchdog);
	tab.loading = false;
	tab.retries = 0;
	const host = safeHost(tab.url);
	// A page that actually rendered is the only proof an engine works for that
	// host, so memory is written here and nowhere else.
	if (host && isEngineUsable(tab.engine)) {
		state.siteEngine[host] = tab.engine;
		healthVerdict(tab.engine, "ok", "rendered " + host);
		saveMemory();
	}
	if (tab !== activeTab()) {
		renderTabs();
		return;
	}
	// A successful render is the current truth; the previous host's failure note
	// stays in memory but stops being the thing the chrome reports.
	state.lastError = "";
	dom.loadbar.firstElementChild.style.width = "100%";
	dom.loadbar.classList.remove("is-loading");
	dom.loadbar.classList.add("is-done");
	setTimeout(() => {
		dom.loadbar.firstElementChild.style.width = "0";
	}, 450);
	setStatus("ready", "ready");
	renderChrome();
	renderTabs();
	renderDrawer();
}

// The load event is a claim, not a result. Give the frame its verification
// window, then either confirm the load or walk the ladder. The token makes a
// stale check a no-op once the tab has moved on.
function settleLoad(tab) {
	const token = tab.loadToken;
	const deadline = Date.now() + LOAD_TIMEOUT - 800;

	const attempt = (step) => {
		if (tab.loadToken !== token || !tab.loading) return;
		const verdict = inspectFrame(tab.frame);

		if (verdict === "ok" || verdict === "unknown") {
			finishLoad(tab);
			return;
		}

		// No navigation committed yet: keep watching, the watchdog owns the
		// ceiling. This is the normal state on a slow school connection.
		if (verdict === "pending") {
			if (Date.now() < deadline) setTimeout(() => attempt(step), 700);
			return;
		}

		// Blank or error page behind a fired load event: retry the read once or
		// twice (slow paint), then move to the next engine.
		if (step < VERIFY_DELAYS.length) {
			setTimeout(() => attempt(step + 1), VERIFY_DELAYS[step]);
			return;
		}

		state.lastError = `${verdict} · ${ENGINE_LABEL[tab.engine]}`;
		renderDrawer();
		failover(tab, verdict);
	};

	setTimeout(() => attempt(0), VERIFY_DELAYS[0]);
}

// Reads the real destination out of a proxy iframe. Scramjet and Ultraviolet
// both encode the target in the frame URL, so the load event is the reliable
// signal — Scramjet's urlchange only fires once the proxified client boots.
function decodeFrameUrl(tab) {
	let href = "";
	try {
		href = tab.frame.contentWindow.location.href;
	} catch {
		href = tab.frame.src || "";
	}
	if (!href || href === "about:blank") return "";

	if (tab.engine === "scramjet") {
		const prefix = location.origin + SJ_PREFIX;
		if (!href.startsWith(prefix)) return "";
		try {
			return decodeURIComponent(href.slice(prefix.length).split("#")[0]);
		} catch {
			return "";
		}
	}

	if (tab.engine === "rammerhead") {
		// Same-origin Rammerhead answers with document.URL on the proxied page; a
		// remote one is cross-origin and unreadable, so the tab keeps the URL it
		// asked for and the frame is trusted on the load event alone.
		try {
			const url = tab.frame.contentDocument?.URL || "";
			return /^https?:/i.test(url) ? url : "";
		} catch {
			return "";
		}
	}

	if (tab.engine !== "ultraviolet") return "";

	const prefix = location.origin + UV_PREFIX;
	if (!href.startsWith(prefix)) return "";
	try {
		return globalThis.Ultraviolet.codec.xor.decode(href.slice(prefix.length).split("#")[0]);
	} catch {
		return "";
	}
}

function noteUrl(tab, next) {
	if (!next) {
		settleLoad(tab);
		return;
	}
	tab.url = next;
	if (tab.history[tab.index] !== next) {
		tab.history = tab.history.slice(0, tab.index + 1);
		tab.history.push(next);
		tab.index = tab.history.length - 1;
	}
	renderChrome();
	renderTabs();
	updateHomeVisibility();
	settleLoad(tab);
}

function attachFrame(tab) {
	tab.frame.addEventListener("load", () => {
		const next = decodeFrameUrl(tab);
		if (!next) {
			settleLoad(tab);
			return;
		}
		if (next === tab.url) {
			renderChrome();
			renderTabs();
			settleLoad(tab);
			return;
		}
		noteUrl(tab, next);
	});

	if (tab.engine !== "scramjet" || !state.controller) return;
	tab.sjFrame = state.controller.createFrame(tab.frame);
	tab.sjFrame.addEventListener("urlchange", (event) => {
		if (!event.url || event.url === tab.url) return;
		noteUrl(tab, event.url);
	});
}

function createFrameElement() {
	const frame = document.createElement("iframe");
	frame.setAttribute("allow", "fullscreen; clipboard-read; clipboard-write; autoplay");
	frame.setAttribute("referrerpolicy", "no-referrer");
	frame.title = "web view";
	return frame;
}

function createTab(engine) {
	const id = state.nextTabId++;
	const host = document.createElement("div");
	host.className = "frame-host";
	host.dataset.tab = String(id);

	const frame = createFrameElement();
	host.appendChild(frame);
	dom.stage.insertBefore(host, dom.home);

	const tab = {
		id,
		engine: engine || firstUsableEngine(),
		manualEngine: null,
		host,
		frame,
		sjFrame: null,
		rhSession: null,
		history: [],
		index: -1,
		url: "",
		loading: false,
		loadStarted: 0,
		loadToken: 0,
		retries: 0,
		watchdog: null,
	};

	attachFrame(tab);
	state.tabs.push(tab);
	return tab;
}

function activateTab(id) {
	state.active = state.tabs.findIndex((tab) => tab.id === id);
	if (state.active < 0) return;
	for (const tab of state.tabs) {
		tab.host.classList.toggle("is-active", tab.id === id);
	}
	state.engine = activeTab().engine;
	renderTabs();
	renderChrome();
	updateHomeVisibility();
}

function closeTab(id) {
	const index = state.tabs.findIndex((tab) => tab.id === id);
	if (index < 0) return;
	const [tab] = state.tabs.splice(index, 1);
	clearTimeout(tab.watchdog);
	tab.host.remove();
	if (!state.tabs.length) {
		const fresh = createTab();
		state.active = -1;
		activateTab(fresh.id);
		return;
	}
	const next = state.tabs[Math.min(index, state.tabs.length - 1)];
	activateTab(next.id);
}

function updateHomeVisibility() {
	const tab = activeTab();
	const blank = !tab || !tab.url;
	dom.home.hidden = !blank;
	if (blank) {
		dom.homeEngine.textContent = ENGINE_LABEL[tab ? tab.engine : state.engine] || "—";
	}
}

function renderTabs() {
	dom.tabstrip.querySelectorAll(".tab").forEach((node) => node.remove());
	for (const tab of state.tabs) {
		const button = document.createElement("div");
		const isActive = tab.id === activeTab()?.id;
		button.className = `tab${isActive ? " is-active" : ""}`;
		button.dataset.tab = String(tab.id);
		button.innerHTML = `
			${tab.loading ? '<span class="tab-spinner"></span>' : ""}
			<span class="tab-label"></span>
			<button class="tab-close" title="Close tab" aria-label="Close tab">×</button>
		`;
		button.querySelector(".tab-label").textContent = tab.url ? hostOf(tab.url) : "New Tab";
		button.addEventListener("click", (event) => {
			if (event.target.closest(".tab-close")) {
				event.stopPropagation();
				closeTab(tab.id);
				return;
			}
			activateTab(tab.id);
		});
		dom.tabstrip.insertBefore(button, dom.newTab);
	}
}

function renderEngines() {
	const tab = activeTab();
	const current = tab ? tab.engine : state.engine;
	dom.engine.replaceChildren();
	for (const engine of ENGINE_ORDER) {
		const usable = isEngineUsable(engine);
		// Rammerhead is always listed: it is a server-side lane, so "missing a
		// server" is a configuration state the user can fix, not a dead engine
		// that should vanish from the bar.
		if (!usable && engine !== "rammerhead") continue;
		const button = document.createElement("button");
		const on = engine === current;
		button.className = `engine-btn${on ? " is-active" : ""}${usable ? "" : " is-unavailable"}`;
		button.dataset.engine = engine;
		button.setAttribute("role", "tab");
		button.setAttribute("aria-selected", String(on));
		button.setAttribute("aria-disabled", String(!usable));
		if (!usable) button.title = "Add a Rammerhead server in Settings to enable this lane";
		button.textContent = ENGINE_LABEL[engine];
		dom.engine.appendChild(button);
	}
}

function renderChrome() {
	const tab = activeTab();
	const url = tab ? tab.url : "";
	if (document.activeElement !== dom.address) dom.address.value = url;
	dom.back.disabled = !tab || tab.index <= 0;
	dom.forward.disabled = !tab || tab.index >= tab.history.length - 1;
	dom.engineNote.textContent = ENGINE_LABEL[tab ? tab.engine : state.engine] || "—";
	renderEngines();
}

/* --------------------------------------------------------------- commands */

function navigate(raw) {
	const parsed = parseCommand(raw);
	const url = normaliseInput(parsed.url);
	if (!url) return;
	let tab = activeTab();
	if (!tab) tab = createTab();

	if (parsed.explicit) {
		// A forced lane is remembered on the tab; loadInTab then honours it for
		// this navigation and every later one until `!auto`.
		if (parsed.engine && isEngineUsable(parsed.engine)) tab.manualEngine = parsed.engine;
		else if (parsed.engine === null) tab.manualEngine = null;
	}

	loadInTab(tab, url);
	updateHomeVisibility();
}

function goHome() {
	const tab = activeTab();
	if (!tab) return;
	clearTimeout(tab.watchdog);
	tab.loading = false;
	tab.loadToken = (tab.loadToken || 0) + 1;
	tab.retries = 0;
	tab.url = "";
	tab.history = [];
	tab.index = -1;
	tab.sjFrame = null;
	tab.frame.src = "about:blank";
	updateHomeVisibility();
	renderChrome();
	renderTabs();
	renderDrawer();
}

function step(delta) {
	const tab = activeTab();
	if (!tab) return;
	const index = tab.index + delta;
	if (index < 0 || index >= tab.history.length) return;
	tab.index = index;
	loadInTab(tab, tab.history[index], { keepHistory: true });
}

// Swap the engine in place without touching history. Used by the button row and
// by failover, so both paths leave the tab in exactly the same shape.
//
// Scramjet and Ultraviolet share one bare-mux transport, and each engine claims
// a client binding on it when it boots. Handing the transport straight from one
// lane to the other leaves the second engine holding a binding that belongs to
// the first, and its first navigation then never commits. Re-seating the
// transport between lanes is cheap (the worker is already warm) and makes the
// handover deterministic in both directions.
function setTabEngine(tab, engine, options) {
	const opts = options || {};
	if (!isEngineUsable(engine)) return false;
	const previousUrl = tab.url;
	const previousEngine = tab.engine;
	const crossedLanes = previousEngine !== engine;

	clearTimeout(tab.watchdog);
	tab.engine = engine;
	tab.manualEngine = opts.manual ? engine : null;
	tab.sjFrame = null;
	tab.retries = 0;
	tab.loadToken = (tab.loadToken || 0) + 1;
	tab.frame.remove();
	const frame = createFrameElement();
	tab.host.appendChild(frame);
	tab.frame = frame;
	attachFrame(tab);
	renderChrome();
	updateHomeVisibility();
	renderDrawer();

	const resume = () => {
		if (tab.engine !== engine) return;
		if (previousUrl) loadInTab(tab, previousUrl, { keepHistory: true, forceEngine: engine });
		else renderEngines();
	};

	if (!crossedLanes) {
		resume();
		return true;
	}

	reseatTransport().then(resume, (error) => {
		console.warn("transport re-seat failed:", error?.message || error);
		resume();
	});
	return true;
}

function failover(tab, reason) {
	clearTimeout(tab.watchdog);
	const host = safeHost(tab.url);
	state.lastError = `${reason} · ${tab.engine}`;
	healthVerdict(tab.engine, "bad", reason);
	if (host) {
		const failed = (state.siteFail[host] ||= []);
		if (!failed.includes(tab.engine)) failed.push(tab.engine);
		if (state.siteEngine[host] === tab.engine) delete state.siteEngine[host];
		saveMemory();
	}

	const next = ENGINE_ORDER.find(
		(engine) => isEngineUsable(engine) && !(host && state.siteFail[host]?.includes(engine))
	);

	if (!next) {
		tab.loading = false;
		tab.retries = 0;
		if (tab === activeTab()) setStatus("no engine left", "error");
		renderTabs();
		renderDrawer();
		return;
	}

	console.warn(`engine failover (${reason}): ${tab.engine} -> ${next}`);
	if (tab === activeTab()) setStatus(`retrying · ${ENGINE_LABEL[next]}`, "busy");
	setTabEngine(tab, next, { manual: false });
}

function switchEngine(engine) {
	const tab = activeTab();
	state.engine = engine;
	if (!tab) {
		renderChrome();
		return;
	}
	// Picking a lane by hand overrides what the ladder learned about this host:
	// the user is saying "try this one again", not "remind me it failed".
	const host = safeHost(tab.url);
	if (host && state.siteFail[host]?.includes(engine)) {
		state.siteFail[host] = state.siteFail[host].filter((entry) => entry !== engine);
		saveMemory();
	}
	if (tab.engine === engine) {
		tab.manualEngine = engine;
		renderDrawer();
		return;
	}
	if (!setTabEngine(tab, engine, { manual: true })) return;
}

/* --------------------------------------------------------------- reconcile */

// The status chip and address bar must never be able to sit on "loading"
// forever. The watchdog handles the slow case; this sweeps the fast one, where
// an iframe fires nothing at all because the request was dropped upstream.
function startReconciler() {
	setInterval(() => {
		const tab = activeTab();
		if (!tab) return;
		if (tab.loading && Date.now() - tab.loadStarted > LOAD_TIMEOUT) {
			failover(tab, "reconcile");
			return;
		}
		const mode = dom.status.dataset.state;
		if (!tab.loading && mode === "busy") setStatus("ready", "ready");
		if (tab.loading && mode === "ready" && tab.loadStarted) setStatus("loading", "busy");
	}, RECONCILE_MS);
}

/* ----------------------------------------------------------------- cloak */

function buildCloakMenu() {
	const cloak = globalThis.AFCloak;
	if (!cloak) return;
	const current = cloak.current();
	dom.cloakList.replaceChildren();
	if (dom.cloakAuto) dom.cloakAuto.checked = cloak.getAuto();

	const options = [{ id: "off", name: "Off" }, ...cloak.presets];
	for (const preset of options) {
		const button = document.createElement("button");
		button.className = `cloak-item${current?.id === preset.id || (!current && preset.id === "off") ? " is-active" : ""}`;
		button.textContent = preset.name;
		button.addEventListener("click", () => {
			cloak.apply(preset.id === "off" ? null : preset);
			buildCloakMenu();
			dom.cloakMenu.hidden = true;
			dom.cloakBtn.setAttribute("aria-expanded", "false");
		});
		dom.cloakList.appendChild(button);
	}

	dom.cloakPanic.replaceChildren();
	for (const preset of cloak.presets) {
		const option = document.createElement("option");
		option.value = preset.id;
		option.textContent = preset.name;
		if (cloak.getPanic() === preset.id) option.selected = true;
		dom.cloakPanic.appendChild(option);
	}
}

function bindCloak() {
	dom.cloakBtn.addEventListener("click", () => {
		const open = dom.cloakMenu.hidden;
		dom.cloakMenu.hidden = !open;
		dom.cloakBtn.setAttribute("aria-expanded", String(open));
		if (open) buildCloakMenu();
	});
	dom.cloakPanic.addEventListener("change", () => {
		globalThis.AFCloak?.setPanic(dom.cloakPanic.value);
	});
	dom.cloakAuto.addEventListener("change", () => {
		globalThis.AFCloak?.setAuto(dom.cloakAuto.checked);
		if (!dom.cloakAuto.checked) autoCloakOff();
	});
	document.addEventListener("click", (event) => {
		if (dom.cloakMenu.hidden) return;
		if (event.target.closest(".cloak-wrap")) return;
		dom.cloakMenu.hidden = true;
		dom.cloakBtn.setAttribute("aria-expanded", "false");
	});
}

// Auto-disguise: the moment the tab stops being visible the title and icon
// become the panic preset, and the moment it comes back the real ones return.
// A tab switch is exactly when a teacher walks past, so this is the one place
// the cloak has to be reactive rather than manual.
function autoCloakOn() {
	const cloak = globalThis.AFCloak;
	if (!cloak || state.autoCloaked || !cloak.getAuto()) return;
	state.autoCloaked = { previous: cloak.current() };
	const preset = cloak.find(cloak.getPanic()) || cloak.find("classroom");
	cloak.apply(preset, { persist: false });
	buildCloakMenu();
}

function autoCloakOff() {
	const cloak = globalThis.AFCloak;
	if (!cloak || !state.autoCloaked) return;
	const previous = state.autoCloaked.previous;
	state.autoCloaked = null;
	cloak.apply(previous, { persist: false });
	buildCloakMenu();
}

function bindAutoCloak() {
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) autoCloakOn();
		else autoCloakOff();
	});
	window.addEventListener("blur", () => {
		if (document.hidden) autoCloakOn();
	});
}

/* ---------------------------------------------------------- diagnostics */

function diagRow(label, value, tone) {
	const row = document.createElement("div");
	row.className = "diag-row";
	const name = document.createElement("strong");
	name.textContent = label;
	const right = document.createElement("span");
	right.textContent = value;
	if (tone) {
		const dot = document.createElement("span");
		dot.className = `diag-dot ${tone}`;
		row.append(name, dot, right);
	} else {
		row.append(name, right);
	}
	return row;
}

function diagGroup(title, rows) {
	const group = document.createElement("div");
	group.className = "diag-group";
	const label = document.createElement("p");
	label.className = "diag-label";
	label.textContent = title;
	group.appendChild(label);
	if (!rows.length) {
		const empty = document.createElement("p");
		empty.className = "diag-empty";
		empty.textContent = "nothing yet";
		group.appendChild(empty);
	} else {
		group.append(...rows);
	}
	return group;
}

function healthTone(engine) {
	const verdict = state.health[engine]?.state;
	if (verdict === "ok") return "ok";
	if (verdict === "bad") return "bad";
	return "warn";
}

function healthText(engine) {
	if (!isEngineUsable(engine)) return "offline";
	const verdict = state.health[engine];
	if (!verdict) return "not probed";
	if (verdict.state === "ok") return `ok · ${verdict.ms}ms`;
	return `${verdict.note || verdict.state} · ${verdict.ms}ms`;
}

async function renderDrawer() {
	if (dom.drawer.hidden) return;
	const tab = activeTab();

	const engineRows = ENGINE_ORDER.map((engine) =>
		diagRow(ENGINE_LABEL[engine], healthText(engine), healthTone(engine))
	);

	const wisp = state.health.wisp;
	engineRows.push(
		diagRow(
			"Wisp socket",
			wisp ? `${wisp.note || wisp.state} · ${wisp.ms}ms` : "not probed",
			wisp ? (wisp.state === "ok" ? "ok" : "bad") : "warn"
		)
	);

	const registrations = await swReport();
	const swRows = registrations.length
		? registrations.map((entry) =>
				diagRow(
					entry.scope,
					entry.active ? "active" : entry.installing ? "installing" : "waiting",
					entry.active ? "ok" : "warn"
				)
		  )
		: [diagRow("service worker", "none registered", "bad")];

	const memoryRows = Object.entries(state.siteEngine).map(([host, engine]) =>
		diagRow(host, ENGINE_LABEL[engine] || engine, "ok")
	);
	for (const [host, list] of Object.entries(state.siteFail)) {
		if (!list.length) continue;
		memoryRows.push(
			diagRow(host, `refused ${list.map((e) => ENGINE_LABEL[e] || e).join(", ")}`, "bad")
		);
	}

	const sessionRows = [
		diagRow("Transport", state.transport || "not set", state.transport ? "ok" : "bad"),
		diagRow("Active tab engine", tab ? ENGINE_LABEL[tab.engine] : "—", tab ? "ok" : "warn"),
		diagRow("Last failure", state.lastError || "none", state.lastError ? "bad" : "ok"),
	];

	dom.drawerBody.replaceChildren(
		diagGroup("Engines", engineRows),
		diagGroup("Workers", swRows),
		diagGroup("Session", sessionRows),
		diagGroup("Engine memory", memoryRows)
	);
}

function reportText() {
	const tab = activeTab();
	return JSON.stringify(
		{
			generated: new Date().toISOString(),
			transport: state.transport,
			usable: ENGINE_ORDER.filter(isEngineUsable),
			health: state.health,
			lastError: state.lastError,
			siteEngine: state.siteEngine,
			siteFail: state.siteFail,
			active: tab ? { engine: tab.engine, url: tab.url, manual: tab.manualEngine } : null,
			boot: globalThis.__afBoot || [],
		},
		null,
		2
	);
}

function copyText(text) {
	const fallback = () => {
		const area = document.createElement("textarea");
		area.value = text;
		area.style.position = "fixed";
		area.style.opacity = "0";
		document.body.appendChild(area);
		area.select();
		let ok = false;
		try {
			ok = document.execCommand("copy");
		} catch {
			ok = false;
		}
		area.remove();
		return ok;
	};
	if (navigator.clipboard?.writeText) {
		return navigator.clipboard.writeText(text).then(
			() => true,
			() => fallback()
		);
	}
	return Promise.resolve(fallback());
}

function openDrawer(open) {
	dom.drawer.hidden = !open;
	if (open) renderDrawer();
}

function bindDrawer() {
	dom.diagBtn.addEventListener("click", () => openDrawer(dom.drawer.hidden));
	dom.drawerClose.addEventListener("click", () => openDrawer(false));
	dom.diagProbe.addEventListener("click", async () => {
		dom.diagProbe.disabled = true;
		dom.diagProbe.textContent = "probing…";
		await Promise.allSettled([probeAllEngines(), probeWisp()]);
		dom.diagProbe.disabled = false;
		dom.diagProbe.textContent = "Run probes";
		renderDrawer();
	});
	dom.diagForget.addEventListener("click", forgetMemory);
	dom.diagCopy.addEventListener("click", async () => {
		const ok = await copyText(reportText());
		toast(ok ? "report copied" : "copy blocked");
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !dom.drawer.hidden) openDrawer(false);
	});
}

/* ------------------------------------------------------- stealth + popout */

function bindStealth() {
	dom.stealthBtn.addEventListener("click", async () => {
		const tab = activeTab();
		if (!tab?.url) {
			toast("open a page first");
			return;
		}
		const ok = await copyText(stealthUrl(tab.url));
		toast(ok ? "stealth link copied" : "copy blocked");
	});

	// A detached window written from about:blank starts with no referrer and no
	// history entry pointing at this page, which is the whole point of a second
	// window for a game or a video.
	dom.popoutBtn.addEventListener("click", () => {
		const tab = activeTab();
		if (!tab?.url) {
			toast("open a page first");
			return;
		}
		const win = window.open("about:blank", "_blank", "width=1080,height=760");
		if (!win) {
			toast("popup blocked");
			return;
		}
		try {
			win.location.replace(stealthUrl(tab.url));
			toast("detached window opened");
		} catch {
			toast("popup blocked");
		}
	});
}

/* ------------------------------------------------------------------- boot */

function buildHome() {
	dom.homeGrid.replaceChildren();
	for (const link of QUICK_LINKS) {
		const button = document.createElement("button");
		button.className = "home-card";
		button.innerHTML = `<strong></strong><span></span>`;
		button.querySelector("strong").textContent = link.label;
		button.querySelector("span").textContent = link.note;
		button.addEventListener("click", () => navigate(link.url));
		dom.homeGrid.appendChild(button);
	}
	renderRecent();
}

function renderRecent() {
	if (!dom.homeRecent) return;
	dom.homeRecent.replaceChildren();
	if (!state.recent.length) {
		dom.homeRecent.hidden = true;
		return;
	}
	dom.homeRecent.hidden = false;
	for (const url of state.recent) {
		const chip = document.createElement("button");
		chip.className = "recent-chip";
		chip.type = "button";
		chip.textContent = hostOf(url);
		chip.title = url;
		chip.addEventListener("click", () => navigate(url));
		dom.homeRecent.appendChild(chip);
	}
}

function bindUi() {
	dom.omnibox.addEventListener("submit", (event) => {
		event.preventDefault();
		navigate(dom.address.value);
		dom.address.blur();
	});
	dom.homeSearch.addEventListener("submit", (event) => {
		event.preventDefault();
		navigate(dom.homeInput.value);
	});
	dom.back.addEventListener("click", () => step(-1));
	dom.forward.addEventListener("click", () => step(1));
	dom.reload.addEventListener("click", () => {
		const tab = activeTab();
		if (!tab || !tab.url) return;
		if (tab.engine === "scramjet" && tab.sjFrame) tab.sjFrame.reload();
		else loadInTab(tab, tab.url, { keepHistory: true });
	});
	dom.homeBtn.addEventListener("click", goHome);
	dom.newTab.addEventListener("click", () => {
		const tab = createTab();
		activateTab(tab.id);
		dom.homeInput.focus();
	});
	// Duplicate inside the hub instead of handing the URL to the OS browser,
	// which would put it straight into the machine's own history.
	dom.openTab.addEventListener("click", () => {
		const current = activeTab();
		if (!current?.url) return;
		const tab = createTab(current.engine);
		tab.manualEngine = current.manualEngine;
		activateTab(tab.id);
		loadInTab(tab, current.url);
	});
	dom.engine.addEventListener("click", (event) => {
		const button = event.target.closest(".engine-btn");
		const engine = button?.dataset.engine;
		if (!engine) return;
		if (!isEngineUsable(engine)) {
			toast("Rammerhead needs a server — add one in Settings.", "error");
			return;
		}
		switchEngine(engine);
	});
	document.addEventListener("keydown", (event) => {
		const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
		if (event.key === "F5") {
			event.preventDefault();
			dom.reload.click();
		}
		if (event.altKey && event.key === "ArrowLeft") step(-1);
		if (event.altKey && event.key === "ArrowRight") step(1);
		if (!typing && event.key === "/") {
			event.preventDefault();
			dom.address.focus();
			dom.address.select();
		}
		if (event.ctrlKey && event.key.toLowerCase() === "l") {
			event.preventDefault();
			dom.address.focus();
			dom.address.select();
		}
		if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
			event.preventDefault();
			openDrawer(dom.drawer.hidden);
		}
		if (event.ctrlKey && event.key.toLowerCase() === "t") {
			event.preventDefault();
			dom.newTab.click();
		}
	});
}

function bootOverlay() {
	const overlay = document.createElement("div");
	overlay.className = "boot";
	overlay.innerHTML = `
		<div class="boot-inner">
			<div class="boot-mark">AF</div>
			<p class="boot-title">Warming the transport</p>
			<p class="boot-sub">negotiating wisp · loading engines</p>
		</div>
	`;
	document.body.appendChild(overlay);
	return {
		done() {
			overlay.classList.add("is-hidden");
			setTimeout(() => overlay.remove(), 400);
		},
		fail(error) {
			overlay.querySelector(".boot-title").textContent = "No engine available";
			overlay.querySelector(".boot-sub").textContent = String(error?.message || error);
			setStatus("offline", "error");
		},
	};
}

async function boot() {
	const stage = (name, extra) => {
		(globalThis.__afBoot ||= []).push(
			`${Math.round(performance.now())}ms ${name}${extra ? " " + extra : ""}`
		);
	};

	stage("start");
	loadMemory();
	buildHome();
	bindUi();
	bindCloak();
	bindAutoCloak();
	bindStealth();
	bindDrawer();
	buildCloakMenu();
	renderChrome();

	const overlay = bootOverlay();
	setStatus("connecting", "busy");

	// Discovery first: the hub server advertises Rammerhead, and the lane list is
	// built from it, so it has to resolve before the first tab exists.
	await discoverEngines();

	// Let the page finish its own fetches before pulling the transport module;
	// the worker import is 1.7 MB and losing that race costs a worker restart.
	if (document.readyState !== "complete") {
		await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
	}

	// The transport binds its relay once, so a dead primary has to be replaced
	// before the worker starts — rotating afterwards leaves every engine pointed
	// at a socket that never opened.
	try {
		stage("wisp:begin");
		await resolveWispFast();
		stage("wisp:done", new URL(WISP_URL).host);
	} catch (error) {
		stage("wisp:failed", String(error?.message || error));
	}

	let transportError = null;
	try {
		stage("transport:begin");
		state.transport = await initTransport();
		stage("transport:done");
	} catch (error) {
		transportError = error;
		stage("transport:failed", String(error?.message || error));
	}

	if (!transportError) {
		try {
			await registerWorkers();
			stage("workers:done");
		} catch (error) {
			console.warn("workers unavailable:", error?.message || error);
		}

		try {
			await initScramjet();
			state.engines.scramjet = true;
			stage("scramjet:done");
		} catch (error) {
			console.warn("scramjet unavailable:", error?.message || error);
			stage("scramjet:failed");
		}

		state.engines.ultraviolet = Boolean(globalThis.Ultraviolet);
		if (state.engines.ultraviolet) stage("ultraviolet:ready");
	}

	if (!ENGINE_ORDER.some(isEngineUsable)) {
		const error = transportError || new Error("no proxy engine could start");
		console.error(error);
		stage("failed", String(error?.message || error));
		overlay.fail(error);
		return;
	}

	state.engine = firstUsableEngine();
	state.booted = true;
	setStatus("ready", "ready");
	const tab = createTab();
	activateTab(tab.id);
	overlay.done();
	startReconciler();
	stage("ready " + ENGINE_ORDER.filter(isEngineUsable).join(","));

	// A stealth link carries its destination in the fragment, so the server log
	// only ever sees /go/. Decode after boot, drop the fragment, navigate.
	const stealth = readStealthHash();
	if (stealth) {
		history.replaceState(null, "", location.pathname + location.search);
		navigate(stealth);
	}

	// The hub hand-off uses query params: ?url= for a destination, ?q= for a
	// search term. Both are consumed once and stripped so a reload does not
	// re-navigate and a shared link stays clean.
	const params = new URLSearchParams(location.search);
	const target = params.get("url");
	const query = params.get("q");
	if (target || query) {
		history.replaceState(null, "", location.pathname);
		navigate(target || query);
	}

	navigator.serviceWorker.addEventListener("controllerchange", () => {
		console.debug("sw controller changed");
	});

	// Probes run in the background: they prove which lane actually answers on
	// this network, warm the shared worker, and fill the diagnostics drawer. They
	// never block a navigation.
	setTimeout(() => {
		probeWisp().then(() => renderDrawer());
	}, 400);
	setTimeout(() => {
		if (state.booted) probeAllEngines();
	}, 1600);
}

boot();

// Debug handle: lets a console session drive individual boot stages without
// re-running the whole sequence.
globalThis.__af = {
	initTransport,
	registerWorkers,
	initScramjet,
	withTimeout,
	dropDatabase,
	loadInTab,
	switchEngine,
	failover,
	engineFor,
	probeAllEngines,
	probeWisp,
	probeEngine,
	inspectFrame,
	parseCommand,
	stealthUrl,
	openDrawer,
	state,
	dom,
};
