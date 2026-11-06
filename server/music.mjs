// AF Game Hub — music API, served by the Node host.
//
// Audius supplies the open catalog (metadata only, audio still comes from
// Audius' own CDN via a 302). LRCLIB supplies lyrics. Both are cached in
// process memory so a class full of tabs does not hammer either upstream.
import { sendJson } from "./http-util.mjs";

const AUDIO_API = "https://api.audius.co/v1";
const LYRICS_API = "https://lrclib.net/api";
const APP_NAME = "AFGameHub";

// Cache ceiling: 512 entries, each dropped once its TTL lapses. Bounded so a
// long-running dev process cannot grow without limit.
const CACHE_LIMIT = 512;
const cache = new Map();

function cacheGet(key) {
	const hit = cache.get(key);
	if (!hit) return null;
	if (hit.expires <= Date.now()) {
		cache.delete(key);
		return null;
	}
	return hit.value;
}

function cacheSet(key, value, ttlSeconds) {
	if (cache.size >= CACHE_LIMIT) {
		const now = Date.now();
		for (const [id, item] of cache) if (item.expires <= now) cache.delete(id);
		if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
	}
	cache.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
	return value;
}

// Fixed-window limiter, keyed by route + client address. Home networks share a
// single NAT address, so the ceiling is deliberately generous.
const RATE_LIMIT = 60;
const RATE_WINDOW = 60_000;
const rateBuckets = new Map();

function rateLimited(key) {
	const now = Date.now();
	const bucket = rateBuckets.get(key);
	if (!bucket || now - bucket.startedAt >= RATE_WINDOW) {
		rateBuckets.set(key, { startedAt: now, count: 1 });
		if (rateBuckets.size > 2000) {
			for (const [id, item] of rateBuckets) if (now - item.startedAt >= RATE_WINDOW) rateBuckets.delete(id);
		}
		return false;
	}
	bucket.count += 1;
	return bucket.count > RATE_LIMIT;
}

function clientKey(req) {
	const forwarded = req.headers["x-forwarded-for"];
	const address = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.socket.remoteAddress || "unknown";
	return address;
}

function toBool(value) {
	return value === true || value === 1 || value === "true" || value === "1";
}

function trackIsPlayable(track) {
	const streamable = track.is_streamable ?? track.isStreamable;
	const gated = track.is_stream_gated ?? track.isStreamGated;
	const unlisted = track.is_unlisted ?? track.isUnlisted;
	const warning = String(track.parental_warning_type ?? track.parentalWarningType ?? "").toLowerCase();
	const explicit = track.is_explicit ?? track.isExplicit ?? track.explicit;
	if (streamable != null && !toBool(streamable)) return false;
	if (toBool(gated) || toBool(unlisted) || toBool(explicit)) return false;
	if (warning && !["none", "clean", "false"].includes(warning)) return false;
	return true;
}

function safeTrack(track) {
	const user = track.user || track.user_data || {};
	const art = track.artwork || {};
	return {
		id: String(track.id || track.track_id || ""),
		title: String(track.title || "Untitled track").slice(0, 180),
		artist: String(track.artist || track.artist_name || user.name || user.handle || "Unknown artist").slice(0, 120),
		user: {
			id: String(user.id || track.user_id || ""),
			handle: String(user.handle || ""),
			name: String(user.name || user.handle || ""),
		},
		artwork: typeof art === "string" ? art : art._480x480 || art._1000x1000 || art._150x150 || "",
		duration: Number(track.duration || 0),
		genre: String(track.genre || "").slice(0, 60),
		play_count: Number(track.play_count ?? track.playCount ?? 0),
		permalink: String(track.permalink || "https://audius.co/"),
		is_streamable: true,
		is_stream_gated: false,
		parental_warning_type: "",
		description: String(track.description || "").slice(0, 1200),
	};
}

function safeArtist(user) {
	const picture = user.profile_picture || {};
	return {
		id: String(user.id || ""),
		name: String(user.name || user.handle || "Artist").slice(0, 120),
		handle: String(user.handle || ""),
		artwork: picture._150x150 || picture._480x480 || "",
		follower_count: Number(user.follower_count ?? 0),
	};
}

async function audiusJson(path, params = {}) {
	const url = new URL(`${AUDIO_API}${path}`);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
	}
	url.searchParams.set("app_name", APP_NAME);
	const response = await fetch(url, {
		headers: { accept: "application/json" },
		signal: AbortSignal.timeout(15_000),
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message = data?.message || data?.error || `Audius returned HTTP ${response.status}.`;
		throw new Error(String(message).slice(0, 260));
	}
	return data;
}

function clampInt(value, fallback, min, max) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(parsed, min), max);
}

const ID_PATTERN = /^[A-Za-z0-9_-]{2,100}$/;

/* ------------------------------------------------------------------ routes */

async function trendingRoute(req, res, url) {
	if (req.method !== "GET") return sendJson(res, 405, { error: "Use GET for music discovery." }, { allow: "GET" });
	const limit = clampInt(url.searchParams.get("limit"), 30, 1, 50);
	const time = ["week", "month", "year", "allTime"].includes(url.searchParams.get("time")) ? url.searchParams.get("time") : "week";
	const key = `trending:${time}:${limit}`;

	try {
		const cached = cacheGet(key);
		if (cached) return sendJson(res, 200, cached, { "cache-control": "public, max-age=60" });
		const data = await audiusJson("/tracks/trending", { time, limit });
		const tracks = (data.data || []).filter(trackIsPlayable).map(safeTrack).filter((track) => track.id);
		return sendJson(res, 200, cacheSet(key, { provider: "Audius", audioOnly: true, tracks }, 600), {
			"cache-control": "public, max-age=60",
		});
	} catch (error) {
		return sendJson(res, 502, { error: `Audius music discovery is unavailable: ${String(error?.message || error)}` });
	}
}

async function searchRoute(req, res, url) {
	if (req.method !== "GET") return sendJson(res, 405, { error: "Use GET for music search." }, { allow: "GET" });
	const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
	if (query.length < 2) return sendJson(res, 400, { error: "Enter at least 2 characters to search." });
	if (rateLimited(`music-search:${clientKey(req)}`)) return sendJson(res, 429, { error: "Too many music searches. Wait a minute and try again." });
	const limit = clampInt(url.searchParams.get("limit"), 30, 1, 50);
	const key = `search:${query.toLowerCase()}:${limit}`;

	try {
		const cached = cacheGet(key);
		if (cached) return sendJson(res, 200, cached, { "cache-control": "public, max-age=60" });
		const [trackData, userData] = await Promise.allSettled([
			audiusJson("/tracks/search", { query, limit, sort_method: "relevant" }),
			audiusJson("/users/search", { query, limit: 12, sort_method: "relevant" }),
		]);
		if (trackData.status === "rejected" && userData.status === "rejected") throw trackData.reason;
		const tracks = trackData.status === "fulfilled"
			? (trackData.value.data || []).filter(trackIsPlayable).map(safeTrack).filter((track) => track.id)
			: [];
		const artists = userData.status === "fulfilled" ? (userData.value.data || []).map(safeArtist).filter((a) => a.id) : [];
		const payload = { provider: "Audius", audioOnly: true, query, tracks, artists };
		return sendJson(res, 200, cacheSet(key, payload, 300), { "cache-control": "public, max-age=60" });
	} catch (error) {
		return sendJson(res, 502, { error: `Audius search failed: ${String(error?.message || error)}` });
	}
}

async function artistRoute(req, res, id) {
	if (req.method !== "GET") return sendJson(res, 405, { error: "Use GET for artist tracks." }, { allow: "GET" });
	if (!ID_PATTERN.test(id)) return sendJson(res, 400, { error: "Invalid artist ID." });
	const key = `artist:${id}`;

	try {
		const cached = cacheGet(key);
		if (cached) return sendJson(res, 200, cached, { "cache-control": "public, max-age=60" });
		const [trackData, userData] = await Promise.allSettled([
			audiusJson(`/users/${encodeURIComponent(id)}/tracks`, { limit: 40, sort: "plays" }),
			audiusJson(`/users/${encodeURIComponent(id)}`),
		]);
		if (trackData.status === "rejected") throw trackData.reason;
		const tracks = (trackData.value.data || []).filter(trackIsPlayable).map(safeTrack).filter((track) => track.id);
		const profile = userData.status === "fulfilled" ? safeArtist(userData.value.data || {}) : null;
		const payload = { provider: "Audius", audioOnly: true, artist: profile, tracks };
		return sendJson(res, 200, cacheSet(key, payload, 300), { "cache-control": "public, max-age=60" });
	} catch (error) {
		return sendJson(res, 502, { error: `Could not load artist tracks: ${String(error?.message || error)}` });
	}
}

async function streamRoute(req, res, id) {
	if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Use GET to stream audio." }, { allow: "GET, HEAD" });
	if (!ID_PATTERN.test(id)) return sendJson(res, 400, { error: "Invalid track ID." });
	// Redirect only. The hub never proxies audio bytes, so the CDN does the work
	// and the track keeps playing if this process restarts mid-song.
	const streamUrl = new URL(`${AUDIO_API}/tracks/${encodeURIComponent(id)}/stream`);
	streamUrl.searchParams.set("app_name", APP_NAME);
	res.writeHead(302, { location: streamUrl.toString(), "cache-control": "no-store" });
	res.end();
}

/* ------------------------------------------------------------------ lyrics */

function parseLrc(raw) {
	const lines = [];
	for (const line of String(raw).split(/\r?\n/)) {
		const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g)];
		if (!stamps.length) continue;
		const text = line.replace(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g, "").trim();
		for (const stamp of stamps) {
			const minutes = Number(stamp[1]);
			const seconds = Number(stamp[2]);
			lines.push({ time: Math.round((minutes * 60 + seconds) * 1000) / 1000, text });
		}
	}
	lines.sort((a, b) => a.time - b.time);
	return lines;
}

function lyricsPayload(record) {
	if (!record) return null;
	const synced = typeof record.syncedLyrics === "string" && record.syncedLyrics.trim() ? record.syncedLyrics : "";
	const plain = typeof record.plainLyrics === "string" ? record.plainLyrics : "";
	const lines = synced
		? parseLrc(synced)
		: plain
			? plain.split(/\r?\n/).map((text) => ({ time: null, text: text.trim() })).filter((line) => line.text)
			: [];
	if (!lines.length) return null;
	// LRCLIB is community-edited and occasional entries are junk placeholders
	// ("probe", a single stray word). Treat anything that short as absent so the
	// search fallback gets a chance at a real record.
	const characters = lines.reduce((total, line) => total + line.text.length, 0);
	if (lines.length < 3 || characters < 24) return null;
	return {
		source: "LRCLIB",
		synced: Boolean(synced),
		trackName: String(record.trackName || ""),
		artistName: String(record.artistName || ""),
		albumName: String(record.albumName || ""),
		duration: Number(record.duration || 0),
		lines,
	};
}

const LYRICS_STOPWORDS = new Set(["the", "a", "an", "of", "and", "in", "to", "it", "is", "my", "me", "i", "you", "we", "on", "for", "with", "feat", "ft", "remix", "edit", "version", "extended", "radio"]);

function titleTokens(value) {
	return new Set(
		String(value || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.split(" ")
			.filter((token) => token.length > 1 && !LYRICS_STOPWORDS.has(token)),
	);
}

async function lyricsRoute(req, res, url) {
	if (req.method !== "GET") return sendJson(res, 405, { error: "Use GET for lyrics." }, { allow: "GET" });
	const title = (url.searchParams.get("title") || "").trim().slice(0, 160);
	const artist = (url.searchParams.get("artist") || "").trim().slice(0, 160);
	const duration = clampInt(url.searchParams.get("duration"), 0, 0, 24 * 60 * 60);
	if (!title) return sendJson(res, 400, { error: "A track title is required." });
	if (rateLimited(`lyrics:${clientKey(req)}`)) return sendJson(res, 429, { error: "Too many lyrics lookups. Wait a minute and try again." });

	const key = `lyrics:${title.toLowerCase()}:${artist.toLowerCase()}:${duration}`;
	const cached = cacheGet(key);
	if (cached) return sendJson(res, 200, cached, { "cache-control": "public, max-age=300" });

	const headers = {
		accept: "application/json",
		// LRCLIB asks clients to identify themselves with a real UA.
		"user-agent": "AFGameHub/5.0 (school project)",
	};

	let payload = { source: "LRCLIB", synced: false, found: false, lines: [] };

	// Audius uploads are frequently covers, remixes, or re-titled edits, so the
	// artist name on the audio almost never matches LRCLIB. The ladder widens
	// until something real comes back: exact record, title+artist search,
	// title-only search. Duration is used to rank, never to reject.
	const searchLyrics = async (query) => {
		const search = new URL(`${LYRICS_API}/search`);
		search.searchParams.set("q", query);
		const response = await fetch(search, { headers, signal: AbortSignal.timeout(10_000) });
		if (!response.ok) return [];
		const results = await response.json().catch(() => []);
		const wanted = titleTokens(title);
		return (Array.isArray(results) ? results : [])
			.slice(0, 12)
			.map((record) => ({ record, parsed: lyricsPayload(record) }))
			.filter((entry) => entry.parsed)
			// A title-only query can drift to an unrelated song ("Dream A Little
			// Dream Of Me" hunting up "The Room Nobody Lives In"). Require one
			// meaningful shared word with the requested title.
			.filter((entry) => wanted.size === 0 || titleTokens(entry.record.trackName).size === 0 || [...titleTokens(entry.record.trackName)].some((token) => wanted.has(token)));
	};
	const rankByDuration = (candidates) => {
		if (!duration || candidates.length < 2) return candidates[0].parsed;
		let best = candidates[0];
		let bestGap = Infinity;
		for (const candidate of candidates) {
			const gap = Math.abs(Number(candidate.record.duration || 0) - duration);
			if (gap < bestGap) {
				best = candidate;
				bestGap = gap;
			}
		}
		return best.parsed;
	};

	try {
		const exact = new URL(`${LYRICS_API}/get`);
		exact.searchParams.set("track_name", title);
		if (artist) exact.searchParams.set("artist_name", artist);
		if (duration) exact.searchParams.set("duration", String(duration));
		const exactResponse = await fetch(exact, { headers, signal: AbortSignal.timeout(10_000) });
		if (exactResponse.ok) {
			const record = await exactResponse.json().catch(() => null);
			const parsed = lyricsPayload(record);
			if (parsed) payload = { ...parsed, found: true };
		}
		for (const query of [[title, artist].filter(Boolean).join(" "), title]) {
			if (payload.found || !query) continue;
			const candidates = await searchLyrics(query);
			if (candidates.length) payload = { ...rankByDuration(candidates), found: true };
		}
	} catch (error) {
		payload = { source: "LRCLIB", synced: false, found: false, lines: [], error: String(error?.message || error).slice(0, 200) };
	}

	return sendJson(res, 200, cacheSet(key, payload, payload.found ? 3600 : 300), {
		"cache-control": "public, max-age=300",
	});
}

/* ------------------------------------------------------------------ health */

export function musicHealth() {
	return { provider: "Audius", lyricsProvider: "LRCLIB", cached: cache.size };
}

// Returns true when the request was handled, so the caller can fall through to
// the generic /api/* passthrough for everything else.
export async function handleMusic(req, res, url) {
	const pathname = url.pathname;

	if (pathname === "/api/music/trending") return trendingRoute(req, res, url), true;
	if (pathname === "/api/music/search") return searchRoute(req, res, url), true;
	if (pathname.startsWith("/api/music/artist/")) {
		return artistRoute(req, res, decodeURIComponent(pathname.slice("/api/music/artist/".length))), true;
	}
	if (pathname.startsWith("/api/music/stream/")) {
		return streamRoute(req, res, decodeURIComponent(pathname.slice("/api/music/stream/".length))), true;
	}
	if (pathname === "/api/lyrics") return lyricsRoute(req, res, url), true;

	return false;
}
