// Health sweep of public relay endpoints. Bare = GET /v3/ meta.
// Wisp = WebSocket upgrade with a short timeout, any subprotocol.
import WebSocket from "ws";

const BARE = [
  "https://bare.mercurywork.shop/",
  "https://bare.iamalekk.com/",
  "https://bare.kwiatekmiki.com/",
  "https://bare.privacydev.net/",
  "https://bare.darktools.tk/",
  "https://bare.nadeko.net/",
  "https://bare.host.mikusensei.com/",
  "https://bare.lunatic.tf/",
  "https://bare.hyper.lol/",
  "https://bare.seitanic.dev/",
  "https://bare.owo.si/",
  "https://bare.ekans.dev/",
  "https://bare.moonlight.tf/",
  "https://bare.wisp.link/",
  "https://bare.titaniumnetwork.dev/",
  "https://bare.cdn.darktools.tk/",
  "https://bare.astartus.dev/",
  "https://bare.anura.pro/",
];

const WISP = [
  "wss://wisp.mercurywork.shop/",
  "wss://wisp.egg.lol/",
  "wss://wisp.birdcat.cafe/",
  "wss://wisp.hydroxide.dev/",
  "wss://wisp.quartz.rip/",
  "wss://wisp.rhodes.rip/",
  "wss://wisp.privacydev.net/",
  "wss://wisp.darktools.tk/",
  "wss://wisp.kwiatekmiki.com/",
  "wss://anura.pro/wisp/",
  "wss://wisp.anura.pro/",
  "wss://wisp.hyper.lol/",
  "wss://wisp.owo.si/",
  "wss://wisp.moonlight.tf/",
  "wss://wisp.astartus.dev/",
];

async function checkBare(base) {
  try {
    const r = await fetch(new URL("v3/", base), {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    return `${r.status} ${(await r.text()).slice(0, 100).replace(/\s+/g, " ")}`;
  } catch (e) {
    return `FAIL ${e.message.slice(0, 90)}`;
  }
}

function checkWisp(url) {
  return new Promise((resolve) => {
    let socket;
    const timer = setTimeout(() => {
      try { socket?.terminate(); } catch {}
      resolve("TIMEOUT");
    }, 6000);
    try {
      socket = new WebSocket(url, ["wisp-v2"]);
      socket.on("open", () => {
        clearTimeout(timer);
        socket.terminate();
        resolve("OPEN");
      });
      socket.on("error", (e) => {
        clearTimeout(timer);
        resolve(`FAIL ${String(e.message).slice(0, 90)}`);
      });
    } catch (e) {
      clearTimeout(timer);
      resolve(`FAIL ${e.message}`);
    }
  });
}

const bare = await Promise.all(BARE.map(async (u) => [u, await checkBare(u)]));
const wisp = await Promise.all(WISP.map(async (u) => [u, await checkWisp(u)]));

console.log("--- BARE ---");
for (const [u, v] of bare) console.log(v.startsWith("FAIL") ? "  " + u + " -> " + v : "UP " + u + " -> " + v);
console.log("--- WISP ---");
for (const [u, v] of wisp) console.log(v === "OPEN" ? "UP " + u : "  " + u + " -> " + v);
