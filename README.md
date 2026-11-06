# AF Game Hub

Games, music, notes, an in-app browser, and a same-origin proxy stack that runs on your own machine. Nothing here talks to Cloudflare, and no third-party origin appears in the page source.

```
public/            static web root (hub shell, /go/ browser, vendor proxy bundles)
server/            Node host: static files, Wisp, Rammerhead, music + lyrics API
scripts/build.mjs  copies the vendored proxy bundles into public/
```

## Requirements

- Node 20+ (verified on Node 26).
- No build tool beyond `scripts/build.mjs`; there is no bundler and no framework.

## Install and run

```powershell
cd afhub
& "C:\Program Files\nodejs\npm.cmd" install
node scripts/build.mjs
$env:PORT = "8099"
node server/index.mjs
```

Then open `http://localhost:8099/`.

`npm run dev` does the build and the start in one step. `npm run build` alone refreshes the vendored proxy bundles after `npm install` or a dependency bump.

## Deploying

The project deploys in two different shapes, and they are not interchangeable.

| Shape | Ships | Proxy engines online |
| --- | --- | --- |
| Cloudflare Worker (`wrangler deploy`) | `worker.js` + everything in `public/` + the `AI` binding | **none** — Workers cannot run the Node proxy server |
| Node host (`server/index.mjs`) | static files, Wisp at `/wisp/`, Rammerhead, music + lyrics | Scramjet, Ultraviolet, and Rammerhead |

`worker.js` is the Workers API (AI chat, Audius music, web search) and the static assets. It has no `/wisp/` upgrade and no Rammerhead, because both need a long-lived Node process with raw sockets. Deploying the Worker puts the hub, games, music, AI, and bookmarks online; `/go/` will boot but the engine list comes back empty. For working proxies online, the Node host is the deployment.

### A. Cloudflare Worker — the hub online

```powershell
cd afhub
& "C:\Program Files\nodejs\npm.cmd" install
node scripts/build.mjs
& "C:\Program Files\nodejs\npx.cmd" wrangler@latest login
& "C:\Program Files\nodejs\npx.cmd" wrangler@latest deploy
```

`wrangler` is already a devDependency, so `npm run deploy` works too. `wrangler login` opens a browser once and stores the account token in `%USERPROFILE%\.wrangler` — that is the only step that has to be repeated on a new machine. Project files, `wrangler.toml`, and the `AI` binding are all already in this folder.

`npm run deploy:dry` builds and validates the bundle without uploading, which is the cheap check before a real deploy. The deploy prints the URL, normally `https://af-game-hub-desync-inspired.<account>.workers.dev`. `wrangler tail` streams live logs; `wrangler deployments list` shows what is live and `wrangler rollback` returns to a previous one.

First deploy on a new machine may ask to create the Worker. Accept — `wrangler.toml` already pins the name and the bindings, so the deployed app replaces the old version rather than creating a second one.

### B. Node host — the full stack online

Any host that runs a persistent process and allows WebSocket upgrades works: a VPS, Render, Railway, Koyeb, Fly, or Docker anywhere.

**VPS (all three engines).** Rammerhead's cross-domain origin needs its own reachable port, so open both:

```bash
# Ubuntu 22.04+, as root
apt update && apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
ufw allow 22 && ufw allow 8099 && ufw allow 8100 && ufw --force enable

git clone <your-repo> /opt/afhub && cd /opt/afhub
npm ci && node scripts/build.mjs
PORT=8099 pm2 start server/index.mjs --name afhub && pm2 save && pm2 startup
curl -s localhost:8099/health
```

Open `http://<server-ip>:8099/`. `/go/` gets Scramjet, Ultraviolet, and Rammerhead. Put Caddy or nginx in front only for port 8099 — port 8100 has to stay reachable directly, because hammerhead rewrites absolute URLs that point at it. Add `https://` on 8099 only if the proxy in front forwards WebSocket upgrades on `/wisp/` and `/<session>/`.

**Render (free, one port).** Push this folder to GitHub, then New → Blueprint and pick the repo; `render.yaml` is already in it. That blueprint sets `AFHUB_RH=0`, because Render exposes one port and Rammerhead needs two — Scramjet and Ultraviolet still work over `/wisp/`, and `/go/` shows two engines instead of three.

**Docker, anywhere.**

```bash
docker build -t afhub .
docker run -d --name afhub -p 8099:8099 -p 8100:8100 afhub
```

`AFHUB_RH=0` drops Rammerhead and leaves the two service-worker engines; use it on any host where only one port is public. `AFHUB_RH_CROSS_PORT` relocates the cross-domain port when the host maps it somewhere else.

### School network notes

The filter only ever sees the deployment's own hostname: every proxied request leaves through `/wisp/` (or is fetched server-side by Rammerhead). Nothing in the page source names a blocked host.

- A custom domain that already resolves on the school network beats a fresh `*.workers.dev` or `*.onrender.com` name, which some filters block by suffix.
- Render's free tier sleeps when idle; the first request after a pause takes a few seconds to wake.
- Cloudflare Workers cannot open raw sockets, so the Worker deployment is a hub, not a proxy. Keep that in mind before replacing the Node host with it.


## Ports

| Port | What it serves |
| --- | --- |
| `PORT` (default 8099) | Hub, `/go/`, Wisp at `/wisp/`, music + lyrics API, Scramjet, Ultraviolet, **and Rammerhead pages** |
| `PORT + 1` | Rammerhead's cross-domain simulation port only (no pages) |

Rammerhead builds every rewritten URL from its own absolute origin (`http://host:PORT/<session>/<url>`), so it cannot live under a path prefix. It still shares the hub's origin and port: hammerhead's client reads `window.parent['%hammerhead%'].nativeMethods` while it boots, and `/go/` is always the parent document. Two ports makes that parent cross-origin, the property access throws `SecurityError`, and every proxied page paints its static HTML and then dies in "hammerhead not loaded yet". One origin means the client installs.

The second port stays a real listener because hammerhead uses it to present a second origin for cross-origin requests. Folding it into the hub port would make every cross-origin fetch look same-origin to the proxied page.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8099` | Main HTTP port. Rammerhead's cross-domain port follows at +1. |
| `HOST` | `0.0.0.0` | Bind address for the main server. |
| `LOG` | `0` | Set to `1` for per-request logging. |
| `API_UPSTREAM` | unset | Proxies `/api/*` calls this app does not serve natively (the Workers AI routes). Without it those return `502`. |
| `AFHUB_RH` | `1` | `0` disables Rammerhead entirely. |
| `AFHUB_RH_CROSS_PORT` | `PORT + 1` | Rammerhead cross-domain port override. |

`GET /health` reports uptime, engine availability, and music cache size.

## The proxy stack

`/go/` is a full-page browser with tabs, an omnibox, and three interchangeable engines.

- **Scramjet** (`/scramjet/sj/`) — default. Service-worker rewrite, same origin, `/wisp/` transport.
- **Ultraviolet** (`/uv/service/`) — same-origin service-worker rewrite, `/wisp/` transport. Only registered when the browser allows `Service-Worker-Allowed: /`.
- **Rammerhead** (`http://host:PORT/<session>/<url>`) — server-side rewriting, no service worker. This is the engine that works on managed Chromebooks where service workers are policy-disabled. Pages are served from the hub's own origin; see below for how that is wired.

`/go/` asks `GET /api/engines` which engines are live and only advertises the reachable ones. Engine choice is remembered per host, and a host that failed on one engine records it in `state.siteFail` so the next visit skips straight to one that worked.

### Rammerhead on the hub origin

`server/rammerhead.mjs` builds `RammerheadProxy` with `dontListen: true`, which suppresses both of hammerhead's listeners. `server/index.mjs` then hands the matching requests straight into `proxy.server1`:

| Path | Owner |
| --- | --- |
| `/hammerhead.js`, `/worker-hammerhead.js`, `/transport-worker.js`, `/task.js`, `/iframe-task.js`, `/messaging`, `/rammerhead.js`, `/api/shuffleDict`, `/syncLocalStorage` | hammerhead service routes |
| `^/[0-9a-f]{32}(?:[/!]\|$)` | a proxied page (session ids are our own 32-char hex UUIDs) |

Both the request handler and the `upgrade` handler check `isRammerheadPath()` before static resolution. Static resolution would otherwise treat `/<session>/<url>` as a missing file and answer with the SPA fallback — the hub rendered inside the frame.

`proxy.server2` keeps a real listener on `PORT + 1`; `dontListen` suppressed both binds, so it is called manually after construction. `_rewriteServerInfo` is wrapped because RammerheadProxy rebuilds `serverInfo` from `getServerInfo()` on every request and drops `wss`, which `/messaging` upgrades then read as `undefined` — the patch re-attaches `wss1` or `wss2` depending on which port the socket landed on.

Three more server-side fixes keep proxied pages usable:

- **Client patch** — `rammerhead@1.2.64`'s shipped client aborts on every page. `server/rammerhead-client.mjs` builds and caches a patched copy, served from the same `/rammerhead.js` route through the on-request pipeline so the package on disk is untouched.
- **Frame headers** — `x-frame-options`, COOP, CORP, and CSP `frame-ancestors` are stripped from rewritten responses, so a page that ships them still renders inside `/go/`. The rest of the site's CSP is preserved.
- **No page caching** — see the service-worker note below.

### Service worker caveat

Scramjet and Ultraviolet depend on service workers and `SharedWorker` for the bare-mux transport. If a device blocks either by policy, those two engines will not initialise — Rammerhead is the fallback, and `/go/` marks them unavailable rather than hanging on a loading bar. The 14-second watchdog fails over instead of waiting forever.

The hub's own worker (`public/sw.js`) is registered at scope `/`, so it also sees every proxied request. `isProxyPath()` returns early for the hammerhead service routes, the session-path shape, and the `/scramjet/`, `/uv/`, `/baremux/`, `/transport/`, `/wisp/` prefixes. Without that bypass the network-first handler would cache proxied pages into the app cache and the offline fallback would answer a proxied navigation with `index.html`. Bump `CACHE` whenever the bypass list changes, or an old worker with the old list keeps running.

### Engine handover

Scramjet and Ultraviolet share one bare-mux transport, and each lane claims its own client binding on the worker when it boots. Moving a navigation from one lane to the other therefore re-seats the transport first (`reseatTransport()`), otherwise the second engine inherits the first one's binding and its first frame never commits. The re-seat is a no-op against a warm worker.

### Engine health

Health is read non-destructively from things that are already true — the bare-mux transport, Scramjet's controller, the `/uv/service/` and `/scramjet/sj/` worker registrations, the Wisp socket, and the verdict of real navigations. There were synthetic probe iframes once; tearing a probe frame down mid-flight leaves Scramjet's worker without a client binding and wedges the lane it was measuring, so a healthy engine got marked dead and demoted for every later navigation.

### Load verification

A `load` event is a claim, not a result. After every load `/go/` inspects the frame body (`inspectFrame`) and sorts it:

| Verdict | Meaning | Action |
| --- | --- | --- |
| `ok` | Real document with content | Trust it, write the host → engine memory |
| `unknown` | A frame that escaped the proxy and became cross-origin | Trust it; the body cannot be read |
| `pending` | Still on `about:blank` / parsing | Keep waiting, the watchdog owns the ceiling |
| `blank` | No text and no media | Retry the read, then walk the ladder |
| `error` | Proxy failure shell or network-failure text | Retry the read, then walk the ladder |

Proxy failure shells are detected by document title (`Scramjet`, `Ultraviolet`, `Rammerhead`) before any length shortcut, because each proxy's own error page fires a normal load event and can carry plenty of text.

### `/go/` features

- **Tabs** — multi-tab, per-tab engine, per-tab history.
- **Omnibox commands** — `!sj <url>` Scramjet, `!uv <url>` Ultraviolet, `!rh <url>` Rammerhead, `!auto <url>` clear the manual lane. A manual lane sticks to the tab until `!auto`.
- **Failover ladder** — Scramjet → Ultraviolet → Rammerhead, one silent retry per lane, then `no engine left`. Failed hosts are recorded so the next visit starts on a lane that worked.
- **Stealth links** — `/go/#<base64url(url)>` (the `#` button). The destination lives in the fragment, so a server log only ever sees `/go/`. Opening one boots the page, strips the hash, and navigates through the ladder.
- **Detached window** — opens the active page in its own window with no referrer and no back-entry to the hub.
- **Diagnostics drawer** — `Ctrl+Shift+D` or the network button. Groups: Engines, Workers, Session, Engine memory. Buttons: Run probes, Copy report, Forget engine memory.
- **Auto-cloak** — when the tab stops being visible the title and favicon become the panic preset; coming back restores them. Toggle in the cloak menu, stored under `af.cloak.auto` (default on).
- **Panic** — `Alt+X` applies the panic preset without persisting it. `AFCloak.apply(null)` clears the cloak.
- **Keys** — `Ctrl+L` focuses the omnibox, `Ctrl+Shift+D` toggles the drawer, `Esc` closes it.

Engine memory (host → engine, and host → refused engines) lives in `localStorage` under `af.go.memory.v1`; recent visits under `af.go.recent.v1`. Both are wiped by "Forget engine memory".


## Music

`server/music.mjs` serves the catalog natively:

| Route | Purpose |
| --- | --- |
| `GET /api/music/trending?time=week&limit=30` | Trending tracks |
| `GET /api/music/search?q=…` | Track search |
| `GET /api/music/artist/:id` | Artist + their tracks (`sort=plays`) |
| `GET /api/music/stream/:id` | 302 to the Audius CDN |
| `GET /api/lyrics?title=…&artist=…&duration=…` | Synced or plain lyrics |

Lyrics come from LRCLIB and resolve through a widening ladder: exact record, then title + artist search, then title-only search. That last step matters because Audius uploads are often covers, so the artist name on the audio frequently does not match LRCLIB. Candidates are filtered so an unrelated song cannot win on a shared stopword, then ranked by duration. Records with fewer than three lines or fewer than 24 characters are treated as junk placeholders, which LRCLIB occasionally publishes.

Responses are cached in memory (512 entries), and lookups are rate limited per client.

## Cloak

`public/js/cloak.js` provides `window.AFCloak` — tab title, favicon, and preset disguises. `public/js/cloak-ui.js` wires the hub dropdown. `Alt+X` panics back to the default disguise. `/go/` has its own cloak menu so the proxy view can be disguised independently, plus auto-cloak on tab switch (`af.cloak.auto`, default on): the title and icon become the panic preset while the tab is hidden and come back when it returns.

## Notes

- The hub service worker is network-first for same-origin app files; the cache is only an offline fallback. Bump `CACHE` in `public/sw.js` if a stale file ever survives a reload. A reload alone can leave the new worker `waiting`; unregister every registration, reload, then wait for the new one to activate.
- Scramjet's IndexedDB is opened read-first. A `deleteDatabase()` blocked by a live connection never completes, and later `open()` calls queue behind it with no `success`, `error`, or `blocked` event — the boot simply stops. Recovery runs only when stores are genuinely missing, is time-boxed, and unregisters the `/scramjet/sj/` worker first so a stale tab cannot hold the connection. `controller.init()` is time-boxed for the same reason.
- Rammerhead shuffles the URL it puts in `location.href` (`_rhs…`). Because the proxied document is same-origin, `frame.contentDocument.URL` still answers with the real destination — that is what `/go/` syncs the address bar from, and what makes in-page link clicks, back, and forward track correctly.
- Vendor bundles in `public/{uv,scramjet,baremux,transport}/` are generated. Do not edit them; rerun `node scripts/build.mjs`.
- Neither directory is a git repo. Everything is working-tree state.
