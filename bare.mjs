// Bare server v3 on Cloudflare Workers.
//
// Wisp hands the browser a raw TCP socket and epoxy-tls performs the TLS
// handshake in WASM. Sites that fingerprint that stack answer `tls handshake
// eof`. Bare moves the request to this Worker, so Node's TLS stack and the
// Worker's own egress do the talking. The browser only ever fetches this host.
//
// Wire format (v3):
//   GET  /bare/v3/                     -> server meta
//   ANY  /bare/v3/?cache=<key>         -> request, with x-bare-* control headers
//   WSS  /bare/v3/                     -> first frame is JSON connect, then raw bytes
//
// Response carries x-bare-status / x-bare-status-text / x-bare-headers so the
// client can rebuild the origin response verbatim.

import { connect } from "cloudflare:sockets";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "x-bare-headers, x-bare-status, x-bare-status-text",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
};

const HOP = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length",
  // Browser-only headers. Workers rejects or mutates some of these, and they
  // describe the hop to the Bare server, never the hop to the destination.
  "accept-encoding", "origin", "referer", "sec-fetch-dest", "sec-fetch-mode",
  "sec-fetch-site", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform",
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

// The client splits headers above 3072 bytes into x-bare-headers-N fragments.
function joinHeaders(headers) {
  let raw = headers.get("x-bare-headers") || "";
  if (headers.has("x-bare-headers-0")) {
    const parts = [];
    for (const [key, value] of headers.entries()) {
      if (!key.startsWith("x-bare-headers-")) continue;
      if (!value.startsWith(";")) continue;
      parts[Number(key.slice("x-bare-headers-".length))] = value.slice(1);
    }
    raw = parts.join("");
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cleanHeaders(headers) {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP.has(lower) || lower.startsWith("x-bare-")) continue;
    try {
      out.set(key, String(value));
    } catch {
      // invalid header name from the remote: drop it
    }
  }
  return out;
}

function publicHost(host) {
  if (!host || host.length > 255) return false;
  const lower = host.toLowerCase().replace(/\.$/, "");
  if (lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) {
    const [a, b] = lower.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  return true;
}

async function bareFetch(request, url) {
  try {
    return await doBareFetch(request);
  } catch (error) {
    // A generic Worker 500 gives the client nothing to work with. Surface the
    // exception as a JSON body so the next browser run names the exact fault.
    return json({ code: "BARE_EXCEPTION", message: String(error?.message || error) }, 500);
  }
}

async function doBareFetch(request) {
  const destination = request.headers.get("x-bare-url");
  if (!destination) return json({ code: "MISSING_BARE_URL", message: "no x-bare-url" }, 400);

  let remote;
  try {
    remote = new URL(destination);
  } catch {
    return json({ code: "INVALID_BARE_URL", message: "bad destination" }, 400);
  }
  if (!/^https?:$/.test(remote.protocol) || !publicHost(remote.hostname)) {
    return json({ code: "BLOCKED", message: "destination refused" }, 403);
  }

  const method = request.method === "GET" || request.method === "HEAD"
    ? request.method
    : request.method;
  const init = {
    method,
    headers: cleanHeaders(joinHeaders(request.headers)),
    // Follow bounded redirects here. Bare clients disagree on how to handle a
    // proxied 301, and a first hop like youtube.com -> www.youtube.com would
    // otherwise land the proxy on a redirect it cannot finish.
    redirect: "follow",
  };
  if (method !== "GET" && method !== "HEAD") init.body = request.body;

  let response;
  try {
    response = await fetch(remote.href, init);
  } catch (error) {
    return json({ code: "FETCH_FAILED", message: String(error?.message || error) }, 502);
  }

  const headers = new Headers(response.headers);
  for (const key of [...headers.keys()]) {
    if (key.startsWith("x-bare-")) headers.delete(key);
  }
  headers.set("x-bare-status", String(response.status));
  headers.set("x-bare-status-text", response.statusText || "");
  headers.set("x-bare-headers", JSON.stringify([...response.headers.entries()]));
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);

  return new Response(response.body, { status: 200, headers });
}

// Bare v3 WebSocket: one JSON connect frame, then bidirectional raw bytes.
function serveBareSocket(server) {
  server.accept();
  server.binaryType = "arraybuffer";

  let socket = null;
  let writer = null;
  let ready = false;
  const send = (data) => {
    try { server.send(data); } catch { /* torn down */ }
  };
  const close = (code, reason) => {
    try { server.close(code, reason); } catch { /* already closed */ }
    try { socket?.close(); } catch { /* already closed */ }
  };

  const teardown = () => {
    try { writer?.close(); } catch { /* already closed */ }
    try { socket?.close(); } catch { /* already closed */ }
  };
  server.addEventListener("close", teardown);
  server.addEventListener("error", teardown);

  server.addEventListener("message", async (event) => {
    if (!ready) {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        close(1008, "invalid connect frame");
        return;
      }
      if (message.type !== "connect") {
        close(1008, "expected connect frame");
        return;
      }
      let remote;
      try {
        remote = new URL(message.remote);
      } catch {
        close(1008, "bad remote");
        return;
      }
      const port = Number(remote.port || (remote.protocol === "https:" ? 443 : 80));
      if (!/^wss?:$/.test(remote.protocol) || !publicHost(remote.hostname) ||
          !(port > 0 && port < 65536)) {
        close(1008, "destination refused");
        return;
      }
      try {
        socket = connect({ hostname: remote.hostname, port });
        writer = socket.writable.getWriter();
      } catch {
        close(1011, "connect failed");
        return;
      }
      ready = true;
      send(new TextEncoder().encode(JSON.stringify({
        type: "open",
        protocol: Array.isArray(message.protocols) ? (message.protocols[0] || "") : "",
      })));

      (async () => {
        try {
          const reader = socket.readable.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value?.byteLength) send(value);
          }
        } catch {
          // network ended
        }
        try { close(1000, "remote closed"); } catch { /* done */ }
      })();
      return;
    }

    if (!socket || !writer) return;
    const data = event.data instanceof ArrayBuffer
      ? new Uint8Array(event.data)
      : new TextEncoder().encode(String(event.data));
    try {
      await writer.write(data);
    } catch {
      close(1011, "write failed");
    }
  });
}

export function bareRoute(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (url.pathname === "/bare/v3" || url.pathname === "/bare/v3/") {
    if ((request.headers.get("Upgrade") || "").toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      serveBareSocket(server);
      const offered = request.headers.get("Sec-WebSocket-Protocol");
      const headers = { "cache-control": "no-store" };
      if (offered) headers["Sec-WebSocket-Protocol"] = offered.split(",")[0].trim();
      return new Response(null, { status: 101, webSocket: client, headers });
    }
    // The client uses the same path for meta and for requests; x-bare-url is
    // the discriminator. A plain GET is meta, a GET carrying it is a fetch.
    if (request.headers.has("x-bare-url")) return bareFetch(request, url);
    return json({ versions: ["3"], ok: true });
  }

  if (url.pathname.startsWith("/bare/v3/")) return bareFetch(request, url);
  return json({ code: "NOT_FOUND", message: "no such bare route" }, 404);
}
