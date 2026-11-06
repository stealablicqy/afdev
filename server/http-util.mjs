// Shared response helpers for the AF Game Hub Node host.

export function sendJson(res, status, payload, extra = {}) {
	if (res.writableEnded) return;
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		...extra,
	});
	res.end(JSON.stringify(payload));
}

export function sendText(res, status, body, type = "text/plain; charset=utf-8") {
	if (res.writableEnded) return;
	res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
	res.end(body);
}
