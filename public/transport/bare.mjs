// bare-mux adapter for Bare server v3.
//
// Wisp carries a raw TCP socket, so epoxy-tls does its own TLS handshake in a
// WASM Hyper client. A growing set of sites fingerprint that stack and kill the
// handshake (HTTP/2 PROTOCOL_ERROR resets, `tls handshake eof`). A Bare server
// makes the request from Node with its own TLS stack and network identity,
// which is the compatibility lane for exactly those destinations.
//
// bare-mux hands transports plain header objects (Record<string,string|string[]>)
// and expects the same shape back. Bare v3 itself speaks x-bare-* headers, so
// this module is the translation layer between the two.

const MAX_HEADER_VALUE = 3072;

function cacheKey(remote) {
	// The cache query is a stable request discriminator, not a credential. Bare
	// clients use MD5 here; FNV-1a is sufficient to keep one URL on one cache
	// entry and avoids shipping a second hashing implementation.
	let hash = 0x811c9dc5;
	const text = remote.toString();
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

function toPairs(headers) {
	const pairs = [];
	if (!headers) return pairs;
	for (const key of Object.keys(headers)) {
		const value = headers[key];
		if (value == null) continue;
		if (Array.isArray(value)) {
			for (const entry of value) pairs.push([key, String(entry)]);
		} else {
			pairs.push([key, String(value)]);
		}
	}
	return pairs;
}

function toObject(pairs) {
	const out = Object.create(null);
	if (!pairs) return out;
	for (const [rawKey, rawValue] of pairs) {
		const key = String(rawKey).toLowerCase();
		const value = String(rawValue);
		const existing = out[key];
		if (existing === undefined) out[key] = value;
		else if (Array.isArray(existing)) existing.push(value);
		else out[key] = [existing, value];
	}
	return out;
}

function splitBareHeaders(headers) {
	const out = new Headers(headers);
	const value = out.get("x-bare-headers");
	if (value && value.length > MAX_HEADER_VALUE) {
		out.delete("x-bare-headers");
		let index = 0;
		for (let i = 0; i < value.length; i += MAX_HEADER_VALUE) {
			out.set(`x-bare-headers-${index++}`, `;${value.slice(i, i + MAX_HEADER_VALUE)}`);
		}
	}
	return out;
}

function joinBareHeaders(headers) {
	const out = new Headers(headers);
	if (!out.has("x-bare-headers-0")) return out;
	const parts = [];
	for (const [key, value] of [...out.entries()]) {
		if (!key.startsWith("x-bare-headers")) continue;
		if (!value.startsWith(";")) throw new Error("invalid split bare header");
		const index = Number(key.slice("x-bare-headers-".length));
		parts[index] = value.slice(1);
		out.delete(key);
	}
	out.set("x-bare-headers", parts.join(""));
	return out;
}

function bareHeaders(remote, pairs, forwardHeaders = []) {
	const encoded = JSON.stringify(Object.fromEntries(pairs));
	const headers = new Headers();
	headers.set("x-bare-url", remote.toString());
	headers.set("x-bare-headers", encoded);
	for (const name of forwardHeaders) headers.append("x-bare-forward-headers", name);
	return splitBareHeaders(headers);
}

function readBareResponse(response) {
	const headers = joinBareHeaders(response.headers);
	const raw = headers.get("x-bare-headers");
	const statusText = headers.get("x-bare-status-text");
	const status = headers.get("x-bare-status");
	const pairs = raw ? Object.entries(JSON.parse(raw)) : [];
	return {
		body: response.body,
		headers: toObject(pairs),
		// Scramjet's HTML rewriter reads rawHeaders to find content-type. Without
		// it, proxied HTML is served un-rewritten and its relative URLs resolve
		// against the proxy origin instead of the destination.
		rawHeaders: pairs,
		status: status ? Number(status) : response.status,
		statusText: statusText || response.statusText,
	};
}

export default class BareTransport {
	constructor(options) {
		const value = typeof options === "string" ? options : options?.bare;
		if (typeof value !== "string" || !/^https?:\/\//i.test(value)) {
			throw new Error("BareTransport needs a Bare server URL");
		}
		this.base = value.replace(/\/+$/, "") + "/v3/";
		this.wsBase = this.base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
		this.ready = true;
	}

	async init() {
		this.ready = true;
	}

	async meta() {
		const response = await fetch(this.base, { credentials: "omit", cache: "no-store" });
		if (!response.ok) throw new Error(`bare meta ${response.status}`);
		return response.json().catch(() => ({}));
	}

	async request(remote, method, body, headers, signal) {
		const pairs = toPairs(headers);
		pairs.push(["Host", remote.host]);
		const options = {
			credentials: "omit",
			method,
			signal,
			cache: "no-store",
			headers: bareHeaders(remote, pairs),
		};
		if (body !== undefined && method !== "GET" && method !== "HEAD") {
			options.body = body;
			if (typeof body !== "string" && !(body instanceof URLSearchParams)) options.duplex = "half";
		}
		const response = await fetch(`${this.base}?cache=${cacheKey(remote)}`, options);
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(`bare ${response.status}: ${detail.slice(0, 200)}`);
		}
		return readBareResponse(response);
	}

	connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
		const ws = new WebSocket(this.wsBase);
		const pairs = toPairs(requestHeaders);
		pairs.push(["Host", url.host]);
		pairs.push(["Upgrade", "websocket"]);
		pairs.push(["Connection", "Upgrade"]);

		let settled = false;
		const cleanup = () => {
			ws.removeEventListener("message", first);
			ws.removeEventListener("close", closed);
		};
		const closed = (event) => {
			cleanup();
			if (!settled) onerror?.(new Error(`bare socket closed before open (${event.code})`));
			else onclose?.(event.code, event.reason);
		};
		const first = (event) => {
			cleanup();
			let message;
			try {
				message = JSON.parse(event.data);
			} catch {
				onerror?.(new Error("bare socket sent a non-JSON greeting"));
				return;
			}
			if (message.type !== "open") {
				onerror?.(new Error(`bare socket greeting was ${message.type}`));
				return;
			}
			settled = true;
			onopen?.(message.protocol || "", "");
			ws.addEventListener("message", (next) => onmessage?.(next.data));
		};
		ws.addEventListener("message", first);
		ws.addEventListener("close", closed);
		ws.addEventListener("error", () => onerror?.(new Error("bare socket error")));
		ws.addEventListener("open", () => {
			ws.send(JSON.stringify({
				type: "connect",
				remote: url.toString(),
				protocols: protocols || [],
				headers: Object.fromEntries(pairs),
				forwardHeaders: [],
			}));
		}, { once: true });

		return [
			(data) => ws.send(data),
			(code, reason) => ws.close(code, reason),
		];
	}
}
