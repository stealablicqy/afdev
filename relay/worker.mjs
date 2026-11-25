// Wisp v2 relay on Cloudflare Workers.
//
// The web client (bare-mux + epoxy) opens one WebSocket to /wisp/?s=<token> and
// multiplexes every proxied TCP stream over it, so the whole proxy lane costs the
// filter exactly one hostname. Wisp framing is little-endian throughout:
//
//   uint8 type | uint32 stream id (LE) | payload
//
// The greeting is CONTINUE on stream 0, which is the v1 opening move. Protocol
// section "Handshake Steps" says a client that receives CONTINUE instead of INFO
// must fall back to v1 and continue — epoxy implements both branches, and the
// reference deployments that already work with this exact client (anura.pro)
// greet the same way. CONTINUE-first is therefore the compatibility path, not a
// shortcut.
//
// Workers cap simultaneous outgoing sockets per invocation, so this is a relay
// for a browsing session, not a seedbox tunnel.

import { connect } from "cloudflare:sockets";
import { bareRoute } from "./bare.mjs";

const PACKET_CONNECT = 0x01;
const PACKET_DATA = 0x02;
const PACKET_CONTINUE = 0x03;
const PACKET_CLOSE = 0x04;
const PACKET_INFO = 0x05;

const STREAM_TCP = 0x01;

// Packets the client may send before it must wait for a CONTINUE. Mirrors the
// 128 anura advertises; every successful write acks one slot so the window holds
// steady instead of sawtoothing to a stall mid-page.
const WINDOW = 128;

const CLOSE_VOLUNTARY = 0x02;
const CLOSE_NETWORK = 0x03;
const CLOSE_INVALID = 0x41;
const CLOSE_UNREACHABLE = 0x42;
const CLOSE_BLOCKED = 0x48;

const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

/* ------------------------------------------------------------- framing */

function frame(type, streamId, payload) {
  const size = 5 + (payload ? payload.byteLength : 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint8(0, type);
  view.setUint32(1, streamId, true);
  if (payload && payload.byteLength) out.set(payload, 5);
  return out;
}

function continueFrame(streamId, slots) {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, slots, true);
  return frame(PACKET_CONTINUE, streamId, payload);
}

function closeFrame(streamId, reason) {
  return frame(PACKET_CLOSE, streamId, new Uint8Array([reason]));
}

/* ------------------------------------------------------------- tokens */

function b64url(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(mac));
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function mintToken(secret) {
  const stamp = Date.now().toString();
  return `${stamp}.${await sign(secret, stamp)}`;
}

async function tokenValid(secret, token) {
  if (typeof token !== "string" || token.length > 256) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const stamp = token.slice(0, dot);
  if (!/^\d{10,16}$/.test(stamp)) return false;
  const age = Date.now() - Number(stamp);
  if (age < -60_000 || age > TOKEN_TTL_MS) return false;
  return equal(await sign(secret, stamp), token.slice(dot + 1));
}

/* ------------------------------------------------------- destination gate */

// A public relay that will dial any address is an SSRF pivot into whatever
// network the caller cannot otherwise reach. Restricted destinations fail closed
// with CLOSE 0x48, which the client surfaces as a dead stream rather than a hang.
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa", ".lan", ".localdomain"];

function isPublicHost(hostname) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 255) return false;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  if (host === "localhost" || host === "::1" || host === "[::1]" || host === "0.0.0.0") return false;

  const quad = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (quad) {
    const a = Number(quad[1]);
    const b = Number(quad[2]);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
  }

  const v6 = host.replace(/^\[|\]$/g, "");
  if (v6.includes(":")) {
    if (v6 === "::" || v6 === "::1") return false;
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return false;
  }

  return true;
}

/* ----------------------------------------------------------- wisp server */

function serveWisp(server) {
  server.accept();
  server.binaryType = "arraybuffer";

  const streams = new Map();

  const send = (buffer) => {
    try {
      server.send(buffer);
    } catch {
      // socket already torn down
    }
  };

  send(continueFrame(0, WINDOW));

  const drop = (streamId, reason) => {
    const entry = streams.get(streamId);
    if (!entry) return;
    streams.delete(streamId);
    send(closeFrame(streamId, reason));
    try {
      entry.socket.close();
    } catch {
      // already closed
    }
  };

  async function pump(streamId, entry) {
    let reader;
    try {
      reader = entry.socket.readable.getReader();
    } catch {
      drop(streamId, CLOSE_NETWORK);
      return;
    }
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength) send(frame(PACKET_DATA, streamId, value));
      }
      if (streams.delete(streamId)) send(closeFrame(streamId, CLOSE_VOLUNTARY));
    } catch (error) {
      console.error("pump", streamId, String(error?.message || error));
      if (streams.delete(streamId)) send(closeFrame(streamId, CLOSE_NETWORK));
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // lock already released
      }
      try {
        entry.socket.close();
      } catch {
        // already closed
      }
    }
  }

  function openStream(streamId, payload) {
    if (streams.has(streamId)) {
      drop(streamId, CLOSE_INVALID);
      return;
    }
    if (payload.byteLength < 3) {
      send(closeFrame(streamId, CLOSE_INVALID));
      return;
    }
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const streamType = view.getUint8(0);
    const port = view.getUint16(1, true);
    const hostname = new TextDecoder().decode(payload.subarray(3)).trim();

    if (streamType !== STREAM_TCP) {
      // UDP is optional in the spec and unavailable on this transport.
      send(closeFrame(streamId, CLOSE_INVALID));
      return;
    }
    if (port < 1 || port > 65535 || !isPublicHost(hostname)) {
      send(closeFrame(streamId, port < 1 || port > 65535 ? CLOSE_INVALID : CLOSE_BLOCKED));
      return;
    }

    let socket;
    try {
      socket = connect({ hostname, port });
    } catch {
      send(closeFrame(streamId, CLOSE_UNREACHABLE));
      return;
    }

    const entry = { socket, writes: Promise.resolve() };
    try {
      entry.writer = socket.writable.getWriter();
    } catch {
      send(closeFrame(streamId, CLOSE_UNREACHABLE));
      return;
    }
    streams.set(streamId, entry);
    pump(streamId, entry);
  }

  server.addEventListener("message", (event) => {
    const raw = event.data;
    if (!(raw instanceof ArrayBuffer) || raw.byteLength < 5) return;
    const bytes = new Uint8Array(raw);
    const view = new DataView(raw);
    const type = view.getUint8(0);
    const streamId = view.getUint32(1, true);
    const payload = bytes.subarray(5);

    if (type === PACKET_CONNECT) {
      openStream(streamId, payload);
      return;
    }

    if (type === PACKET_DATA) {
      const entry = streams.get(streamId);
      if (!entry || !payload.byteLength) return;
      // Serialised through one promise per stream: parallel writes into a Writable
      // are unordered, and a chunked HTTP body written out of order corrupts the
      // stream. One CONTINUE per completed write keeps the client's window open.
      entry.writes = entry.writes
        .then(() => entry.writer.write(payload))
        .then(() => send(continueFrame(streamId, 1)))
        .catch(() => drop(streamId, CLOSE_NETWORK));
      return;
    }

    if (type === PACKET_CLOSE) {
      const entry = streams.get(streamId);
      if (!entry) return;
      streams.delete(streamId);
      try {
        entry.writer.close();
      } catch {
        // already closed
      }
      try {
        entry.socket.close();
      } catch {
        // already closed
      }
      return;
    }

    if (type === PACKET_INFO) {
      // A client that opened with INFO gets the v1 acknowledgement so it can start
      // sending CONNECT immediately.
      send(continueFrame(0, WINDOW));
    }
  });

  const teardown = () => {
    for (const streamId of [...streams.keys()]) {
      const entry = streams.get(streamId);
      streams.delete(streamId);
      try {
        entry.writer.close();
      } catch {
        // already closed
      }
      try {
        entry.socket.close();
      } catch {
        // already closed
      }
    }
  };

  server.addEventListener("close", teardown);
  server.addEventListener("error", teardown);
}

/* --------------------------------------------------------------- routes */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Their mint only answers when the Referer is their own origin, which a
    // browser cannot forge. This Worker can, so it fetches the token for us
    // and hands it to the page with CORS. The socket itself stays direct.
    if (url.pathname === "/api/dsync") {
      try {
        const upstream = await fetch("https://desynctutoring.com/api/session", {
          headers: {
            Referer: "https://desynctutoring.com/",
            "User-Agent": "Mozilla/5.0",
          },
          cache: "no-store",
        });
        const text = await upstream.text();
        return new Response(text, {
          status: upstream.status,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
            "cache-control": "no-store",
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: String(error?.message || error) }), {
          status: 502,
          headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        });
      }
    }

    // On Cloudflare Pages the advanced-mode worker sees every path first.
    // Static files belong to the Pages asset binding; only relay routes are
    // ours. Without this, /go/ and every .js file get the JSON root response.
    // Engine URL space is intercepted by each proxy's service worker. If the
    // host answers those paths with its SPA shell instead of a 404, the worker
    // never gets the chance and the frame shows the hub instead of the site.
    const PROXY_PREFIX = /^\/(scramjet\/sj\/|uv\/service\/)/;
    if (env.ASSETS && PROXY_PREFIX.test(url.pathname)) {
      return new Response(null, { status: 404 });
    }
    if (env.ASSETS && !/^\/(api|wisp|bare)(\/|$)/.test(url.pathname) && url.pathname !== "/health") {
      return env.ASSETS.fetch(request);
    }

    // Bare v3 is the TLS compatibility lane. Same host as the Wisp relay, so a
    // filter sees one additional path on a domain it already allows.
    if (url.pathname.startsWith("/bare/")) return bareRoute(request, env);

    const secret = env.WISP_SECRET || "";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/api/session" || url.pathname === "/api/session/") {
      if (!secret) return json({ error: "relay not configured" }, 500);
      // Minted per call site so a token is never replayed across seats. The stamp
      // is the credential's whole lifetime; nothing is stored server side.
      return json({ ok: true, s: await mintToken(secret), ttl: Math.round(TOKEN_TTL_MS / 1000) });
    }

    if (url.pathname === "/wisp" || url.pathname === "/wisp/") {
      if (!secret) return json({ error: "relay not configured" }, 500);
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
        return json({ error: "expected websocket upgrade" }, 426);
      }
      if (!(await tokenValid(secret, url.searchParams.get("s")))) {
        // 401 rather than a WS close: the client treats a failed upgrade as a dead
        // relay and rotates, which is the behaviour we want for a stale token.
        return json({ error: "bad or expired token" }, 401);
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      serveWisp(server);

      const headers = { "cache-control": "no-store" };
      // A browser that offered a subprotocol rejects the connection unless the 101
      // names one of them. Epoxy always offers one, so it is echoed here.
      const offered = request.headers.get("Sec-WebSocket-Protocol");
      if (offered) headers["Sec-WebSocket-Protocol"] = offered.split(",")[0].trim();

      return new Response(null, { status: 101, webSocket: client, headers });
    }

    if (url.pathname === "/health") return json({ ok: Boolean(secret) });

    // Single-shot TCP probe: one connect, one request, one bounded read, and the
    // error string on failure. Exists so a transport failure can be diagnosed from
    // curl instead of a browser console.
    if (url.pathname === "/api/probe") {
      if (!secret) return json({ error: "relay not configured" }, 500);
      if (!(await tokenValid(secret, url.searchParams.get("s")))) return json({ error: "bad or expired token" }, 401);
      const hostname = url.searchParams.get("host") || "";
      const port = Number(url.searchParams.get("port") || 80);
      if (!isPublicHost(hostname) || !(port > 0 && port < 65536)) return json({ error: "destination refused" }, 400);
      const path = url.searchParams.get("path") || "/";
      const started = Date.now();
      let socket;
      try {
        socket = connect({ hostname, port });
        await socket.opened;
      } catch (error) {
        return json({ stage: "connect", ms: Date.now() - started, error: String(error?.message || error) }, 502);
      }
      try {
        const writer = socket.writable.getWriter();
        await writer.write(new TextEncoder().encode(`GET ${path} HTTP/1.0\r\nHost: ${hostname}\r\n\r\n`));
        writer.releaseLock();
        const reader = socket.readable.getReader();
        const chunk = await Promise.race([
          reader.read(),
          new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 6000)),
        ]);
        reader.releaseLock();
        if (chunk?.timeout) return json({ stage: "read", ms: Date.now() - started, error: "read timeout" }, 504);
        const text = chunk.value ? new TextDecoder().decode(chunk.value) : "";
        return json({ stage: "ok", ms: Date.now() - started, head: text.split("\r\n")[0], bytes: chunk.value?.byteLength ?? 0 });
      } catch (error) {
        return json({ stage: "transfer", ms: Date.now() - started, error: String(error?.message || error) }, 502);
      } finally {
        try {
          socket.close();
        } catch {
          // already closed
        }
      }
    }

    return json(
      {
        name: "af-wisp-relay",
        ok: Boolean(secret),
        mint: "/api/session",
        wisp: "/wisp/?s=<token>",
        protocol: "wisp/2.1",
      },
      200
    );
  },
};
