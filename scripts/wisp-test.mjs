import WebSocket from "ws";

const BASE = "https://af-wisp-relay.jaay847.workers.dev";
const WS = "wss://af-wisp-relay.jaay847.workers.dev/wisp/";

const HOST = process.argv[2] || "portquiz.net";
const PORT = Number(process.argv[3] || 80);
const N = Number(process.argv[4] || 20);

function f(type, id, payload) {
  const size = 5 + (payload ? payload.length : 0);
  const b = Buffer.alloc(size);
  b.writeUInt8(type, 0);
  b.writeUInt32LE(id >>> 0, 1);
  if (payload) payload.copy(b, 5);
  return b;
}
const connectP = (id, host, port) => {
  const h = Buffer.from(host, "utf8");
  const p = Buffer.alloc(3 + h.length);
  p.writeUInt8(1, 0);
  p.writeUInt16LE(port, 1);
  h.copy(p, 3);
  return f(1, id, p);
};
const req = (host) => Buffer.from(`GET / HTTP/1.0\r\nHost: ${host}\r\n\r\n`);

async function mint() {
  const r = await fetch(BASE + "/api/session");
  return (await r.json()).s;
}

async function single(token) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(WS + "?s=" + encodeURIComponent(token), ["wisp-v2"]);
    const acc = new Map();
    const out = { greeting: null, stream1: null, close1: null, openMs: 0 };
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(out); }, 12000);
    ws.binaryType = "nodebuffer";
    ws.on("open", () => { out.openMs = Date.now() - t0; });
    ws.on("message", (b) => {
      const type = b.readUInt8(0);
      const id = b.readUInt32LE(1);
      if (out.greeting === null) out.greeting = { type, id, bytes: b.length };
      if (type === 3 && id === 0) {
        ws.send(connectP(1, HOST, PORT));
        ws.send(f(2, 1, req(HOST)));
      }
      if (type === 2) {
        acc.set(id, Buffer.concat([acc.get(id) || Buffer.alloc(0), b.subarray(5)]));
        if (id === 1 && !out.stream1 && acc.get(1).length > 80) {
          out.stream1 = acc.get(1).toString("utf8").split("\r\n")[0] + " | " + acc.get(1).length + "B";
        }
      }
      if (type === 4) {
        if (id === 1) out.close1 = "0x" + b.readUInt8(5).toString(16);
        if (acc.get(1) && !out.stream1) out.stream1 = "partial " + acc.get(1).length + "B";
        clearTimeout(timer); ws.close(); resolve(out);
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); resolve({ ...out, error: String(e.message).slice(0, 80) }); });
    ws.on("close", () => { clearTimeout(timer); resolve(out); });
  });
}

async function burst(token, n) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS + "?s=" + encodeURIComponent(token), ["wisp-v2"]);
    const answered = new Set();
    const closed = new Map();
    ws.binaryType = "nodebuffer";
    ws.on("open", () => {
      for (let i = 1; i <= n; i += 1) {
        ws.send(connectP(i, HOST, PORT));
        ws.send(f(2, i, req(HOST)));
      }
    });
    ws.on("message", (b) => {
      const type = b.readUInt8(0);
      const id = b.readUInt32LE(1);
      if (type === 2) answered.add(id);
      if (type === 4) closed.set(id, "0x" + b.readUInt8(5).toString(16));
    });
    setTimeout(() => {
      try { ws.close(); } catch {}
      const reasons = {};
      for (const r of closed.values()) reasons[r] = (reasons[r] || 0) + 1;
      resolve({ requested: n, answered: answered.size, closed: closed.size, reasons });
    }, 12000);
  });
}

const t1 = await mint();
console.log("single:", JSON.stringify(await single(t1)));
const t2 = await mint();
console.log("burst:", JSON.stringify(await burst(t2, N)));
