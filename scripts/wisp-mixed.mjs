import WebSocket from "ws";

const BASE = "https://af-wisp-relay.jaay847.workers.dev";
const WS = "wss://af-wisp-relay.jaay847.workers.dev/wisp/";

const HOSTS = ["portquiz.net", "neverssl.com", "github.com", "httpbin.org", "wikipedia.org", "bing.com", "iana.org", "gstatic.com"];

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

const mint = async () => (await (await fetch(BASE + "/api/session")).json()).s;

function run(token, host, n) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS + "?s=" + encodeURIComponent(token), ["wisp-v2"]);
    const answered = new Set();
    const reasons = {};
    ws.binaryType = "nodebuffer";
    ws.on("open", () => {
      for (let i = 1; i <= n; i += 1) {
        ws.send(connectP(i, host, 80));
        ws.send(f(2, i, Buffer.from(`GET / HTTP/1.0\r\nHost: ${host}\r\n\r\n`)));
      }
    });
    ws.on("message", (b) => {
      const type = b.readUInt8(0);
      const id = b.readUInt32LE(1);
      if (type === 2) answered.add(id);
      if (type === 4) {
        const r = "0x" + b.readUInt8(5).toString(16);
        reasons[r] = (reasons[r] || 0) + 1;
      }
    });
    setTimeout(() => { try { ws.close(); } catch {} resolve({ host, answered: answered.size, of: n, reasons }); }, 14000);
  });
}

const token = await mint();
const results = await Promise.all(HOSTS.map((h) => run(token, h, 5)));
const totalAnswered = results.reduce((a, r) => a + r.answered, 0);
console.log(JSON.stringify({ perSocket: results, total: totalAnswered + "/" + HOSTS.length * 5 }, null, 1));
