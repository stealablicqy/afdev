// bare-mux <-> epoxy-transport v3 adapter.
//
// bare-mux hands transports plain objects (Record<string, string | string[]>),
// but epoxy-transport v3 speaks @mercuryworkshop/proxy-transports' RawHeaders
// (Array<[key, value]>). Without this shim every request throws on the first
// `for (const [key, value] of headers)` destructure inside epoxy's request().
import EpoxyTransport from "./epoxy-client.mjs";

function pairsToObject(pairs) {
	const headers = Object.create(null);
	if (!pairs) return headers;
	for (const [rawKey, rawValue] of pairs) {
		const key = String(rawKey).toLowerCase();
		const value = String(rawValue);
		const existing = headers[key];
		if (existing === undefined) headers[key] = value;
		else if (Array.isArray(existing)) existing.push(value);
		else headers[key] = [existing, value];
	}
	return headers;
}

function objectToPairs(headers) {
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

export default class BareEpoxyTransport extends EpoxyTransport {
	async request(remote, method, body, headers, signal) {
		const response = await super.request(
			remote,
			method,
			body,
			objectToPairs(headers),
			signal
		);
		return {
			body: response.body,
			headers: pairsToObject(response.headers),
			status: response.status,
			statusText: response.statusText,
		};
	}

	connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
		return super.connect(
			url,
			protocols,
			objectToPairs(requestHeaders),
			(protocol) => onopen(protocol || ""),
			onmessage,
			onclose,
			onerror
		);
	}

	async meta() {
		return {};
	}
}
