// Live probe: can each relay lane actually reach the destinations that fail?
const RELAY = "https://af-wisp-relay.jaay847.workers.dev";
const BARE = [
  "https://bare.mercurywork.shop/",
  "https://bare.iamalekk.com/",
  "https://bare.kwiatekmiki.com/",
];

async function probe(host, port, path, token) {
  const url = `${RELAY}/api/probe?s=${encodeURIComponent(token)}&host=${encodeURIComponent(host)}&port=${port}&path=${encodeURIComponent(path)}`;
  try {
    const r = await fetch(url, { cache: "no-store" });
    return `${r.status} ${await r.text()}`;
  } catch (e) {
    return `fetch failed: ${e.message}`;
  }
}

const session = await fetch(`${RELAY}/api/session`, { cache: "no-store" });
const body = await session.json();
console.log("session", session.status, JSON.stringify(body).slice(0, 120));
const token = body.s;
if (!token) process.exit(0);

for (const host of ["discord.com", "www.youtube.com", "duckduckgo.com", "example.com"]) {
  console.log(`relay ${host}:443 ->`, await probe(host, 443, "/", token));
}

for (const base of BARE) {
  try {
    const r = await fetch(new URL("v3/", base), { cache: "no-store" });
    console.log(`bare ${base} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
  } catch (e) {
    console.log(`bare ${base} -> FAIL ${e.message}`);
  }
}
