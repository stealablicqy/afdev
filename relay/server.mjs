// Local Wisp v2 + Bare v3 relay for Node 18+.
// Run: node relay/server.mjs   (listens on 127.0.0.1:8787)
// Expose with: cloudflared tunnel --url http://localhost:8787
// The browser talks to the tunnel host; this process does the TCP/TLS work, so
// destinations see the machine's own IP instead of a shared datacenter range.

import http from "node:http";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const WINDOW = 128;

const PACKET_CONNECT = 0x01, PACKET_DATA = 0x02, PACKET_CONTINUE = 0x03;
const PACKET_CLOSE = 0x04, PACKET_INFO = 0x05;
const CLOSE_VOLUNTARY = 0x02, CLOSE_NETWORK = 0x03, CLOSE_INVALID = 0x41;
const CLOSE_UNREACHABLE = 0x42, CLOSE_BLOCKED = 0x48;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "x-bare-headers, x-bare-status, x-bare-status-text",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
};

function json(res, body, status = 200) {
  const text = JSON.stringify(body);
  res.writeHead(status, { ...CORS, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function frame(type, streamId, payload) {
  const out = Buffer.alloc(5 + (payload ? payload.length : 0));
  out.writeUInt8(type, 0);
  out.writeUInt32LE(streamId, 1);
  if (payload) Buffer.from(payload).copy(out, 5);
  return out;
}

function continueFrame(streamId, slots) {
  const p = Buffer.alloc(4);
  p.writeUInt32LE(slots, 0);
  return frame(PACKET_CONTINUE, streamId, p);
}

function closeFrame(streamId, reason) {
  return frame(PACKET_CLOSE, streamId, Buffer.from([reason]));
}

function publicHost(host) {
  if (!host || host.length > 255) return false;
  const h = host.toLowerCase().replace(/\.$/, "");
  if (["localhost", "::1", "[::1]", "0.0.0.0"].includes(h)) return false;
  if ([".local", ".internal", ".localhost", ".home.arpa", ".lan"].some((s) => h.endsWith(s))) return false;
  const q = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (q) {
    const a = +q[1], b = +q[2];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (h.includes(":")) {
    const v = h.replace(/^\[|\]$/g, "");
    if (v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v)) return false;
  }
  return true;
}

/* ---------------------------------------------------------------- Wisp v2 */

const wispServer = new WebSocketServer({ noServer: true });
wispServer.on("connection", (ws) => {
  ws.binaryType = "nodebuffer";
  const streams = new Map();
  const send = (b) => { try { if (ws.readyState === 1) ws.send(b); } catch { /* gone */ } };
  const drop = (id, reason) => {
    const e = streams.get(id);
    if (!e) return;
    streams.delete(id);
    send(closeFrame(id, reason));
    try { e.socket.destroy(); } catch { /* gone */ }
  };
  send(continueFrame(0, WINDOW));

  ws.on("message", (raw) => {
    if (!Buffer.isBuffer(raw) || raw.length < 5) return;
    const type = raw[0];
    const id = raw.readUInt32LE(1);
    const payload = raw.subarray(5);

    if (type === PACKET_CONNECT) {
      if (streams.has(id)) return drop(id, CLOSE_INVALID);
      if (payload.length < 3) return send(closeFrame(id, CLOSE_INVALID));
      const streamType = payload[0];
      const port = payload.readUInt16LE(1);
      const hostname = payload.subarray(3).toString("utf8").trim();
      if (streamType !== 0x01 || port < 1 || port > 65535 || !publicHost(hostname)) {
        return send(closeFrame(id, port < 1 || port > 65535 ? CLOSE_INVALID : CLOSE_BLOCKED));
      }
      let socket;
      try {
        socket = net.connect({ host: hostname, port });
      } catch {
        return send(closeFrame(id, CLOSE_UNREACHABLE));
      }
      const entry = { socket, queue: Promise.resolve() };
      streams.set(id, entry);
      socket.on("connect", () => {});
      socket.on("data", (chunk) => { if (chunk.length) send(frame(PACKET_DATA, id, chunk)); });
      socket.on("close", () => { if (streams.delete(id)) send(closeFrame(id, CLOSE_VOLUNTARY)); });
      socket.on("error", () => { if (streams.delete(id)) send(closeFrame(id, CLOSE_NETWORK)); });
      return;
    }

    if (type === PACKET_DATA) {
      const e = streams.get(id);
      if (!e || !payload.length) return;
      e.queue = e.queue.then(() => new Promise((resolve) => {
        if (!e.socket.writable) return resolve();
        e.socket.write(payload, () => { send(continueFrame(id, 1)); resolve(); });
      })).catch(() => drop(id, CLOSE_NETWORK));
      return;
    }

    if (type === PACKET_CLOSE) {
      const e = streams.get(id);
      if (!e) return;
      streams.delete(id);
      try { e.socket.destroy(); } catch { /* gone */ }
      return;
    }

    if (type === PACKET_INFO) send(continueFrame(0, WINDOW));
  });

  const teardown = () => { for (const id of [...streams.keys()]) drop(id, CLOSE_NETWORK); };
  ws.on("close", teardown);
  ws.on("error", teardown);
});

/* ---------------------------------------------------------------- Bare v3 */

const bareSocketServer = new WebSocketServer({ noServer: true });
bareSocketServer.on("connection", (ws) => {
  ws.binaryType = "nodebuffer";
  let socket = null;
  let ready = false;
  const send = (b) => { try { if (ws.readyState === 1) ws.send(b); } catch { /* gone */ } };
  const teardown = () => { try { socket?.destroy(); } catch { /* gone */ } };
  ws.on("close", teardown);
  ws.on("error", teardown);

  ws.on("message", (raw) => {
    if (!ready) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return ws.close(1008, "bad frame"); }
      if (msg.type !== "connect") return ws.close(1008, "expected connect");
      let remote;
      try { remote = new URL(msg.remote); } catch { return ws.close(1008, "bad remote"); }
      const port = Number(remote.port || (remote.protocol === "https:" ? 443 : 80));
      if (!publicHost(remote.hostname) || !(port > 0 && port < 65536)) return ws.close(1008, "refused");
      try { socket = net.connect({ host: remote.hostname, port }); } catch { return ws.close(1011, "connect failed"); }
      ready = true;
      socket.on("data", (c) => send(c));
      socket.on("close", () => { try { ws.close(1000, "remote closed"); } catch { /* gone */ } });
      socket.on("error", () => { try { ws.close(1011, "network error"); } catch { /* gone */ } });
      return send(Buffer.from(JSON.stringify({
        type: "open",
        protocol: Array.isArray(msg.protocols) ? (msg.protocols[0] || "") : "",
      })));
    }
    if (socket && socket.writable) socket.write(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw)));
  });
});

function splitHeaders(headers) {
  const out = new Headers(headers);
  const value = out.get("x-bare-headers");
  if (value && value.length > 3072) {
    out.delete("x-bare-headers");
    let i = 0;
    for (let at = 0; at < value.length; at += 3072) out.set(`x-bare-headers-${i++}`, `;${value.slice(at, at + 3072)}`);
  }
  return out;
}

function joinHeaders(headers) {
  let raw = headers.get("x-bare-headers") || "";
  if (headers.has("x-bare-headers-0")) {
    const parts = [];
    for (const [k, v] of headers.entries()) {
      if (k.startsWith("x-bare-headers-") && v.startsWith(";")) parts[Number(k.slice(15))] = v.slice(1);
    }
    raw = parts.join("");
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const HOP = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length",
  "accept-encoding", "origin", "referer", "sec-fetch-dest", "sec-fetch-mode",
  "sec-fetch-site", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform",
]);

async function bareFetch(req, res, url) {
  const destination = req.headers["x-bare-url"];
  if (!destination) return json(res, { code: "MISSING_BARE_URL" }, 400);
  let remote;
  try { remote = new URL(destination); } catch { return json(res, { code: "BAD_URL" }, 400); }
  if (!/^https?:$/.test(remote.protocol) || !publicHost(remote.hostname)) return json(res, { code: "BLOCKED" }, 403);

  const headers = new Headers();
  for (const [k, v] of Object.entries(joinHeaders(new Headers(req.headers)))) {
    if (HOP.has(k.toLowerCase()) || k.toLowerCase().startsWith("x-bare-")) continue;
    try { headers.set(k, String(Array.isArray(v) ? v[0] : v)); } catch { /* drop */ }
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  try {
    const upstream = await fetch(remote.href, {
      method: req.method,
      headers,
      redirect: "follow",
      ...(body.length && req.method !== "GET" && req.method !== "HEAD" ? { body } : {}),
    });
    const outHeaders = { ...CORS };
    for (const [k, v] of upstream.headers) {
      // Node's fetch already decompressed the body. Forwarding the encoding
      // header makes clients try again and blow up with a decompression error.
      if (!k.startsWith("x-bare-") && !HOP.has(k) && k !== "content-encoding") outHeaders[k] = v;
    }
    outHeaders["x-bare-status"] = String(upstream.status);
    outHeaders["x-bare-status-text"] = upstream.statusText || "";
    outHeaders["x-bare-headers"] = JSON.stringify([...upstream.headers.entries()]);
    res.writeHead(200, outHeaders);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    json(res, { code: "FETCH_FAILED", message: String(error?.message || error) }, 502);
  }
}

/* ------------------------------------------------------------------ serve */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  if (url.pathname === "/api/session") return json(res, { s: `${Date.now()}.${randomBytes(16).toString("hex")}` });
  if (url.pathname === "/health") return json(res, { ok: true, wisp: "/wisp/", bare: "/bare/v3/" });
  if (url.pathname === "/bare/v3" || url.pathname === "/bare/v3/") {
    if (req.headers["x-bare-url"]) return bareFetch(req, res, url);
    return json(res, { versions: ["3"] });
  }
  if (url.pathname.startsWith("/bare/v3/")) return bareFetch(req, res, url);
  return json(res, { name: "af-relay-node", ok: true });
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  const target = (url.pathname === "/wisp" || url.pathname === "/wisp/") ? wispServer
    : (url.pathname === "/bare/v3" || url.pathname === "/bare/v3/") ? bareSocketServer
    : null;
  if (!target) return socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});

server.listen(PORT, HOST, () => {
  console.log(`AF relay listening on http://${HOST}:${PORT}`);
  console.log(`Wisp: /wisp/  Bare: /bare/v3/  Session: /api/session`);
});
