# Local relay (no card, no cloud account)

Runs Wisp v2 + Bare v3 on your own machine. Sites see your home IP, which is
what fixes YouTube 429s and bot challenges from shared datacenter egress.

## 1. Start the relay

From the repo root:

```
node relay/server.mjs
```

You should see:

```
AF relay listening on http://127.0.0.1:8787
Wisp: /wisp/  Bare: /bare/v3/  Session: /api/session
```

Needs Node 18+ and the `ws` package (`npm install ws`).

## 2. Expose it with a free tunnel

Download cloudflared (Windows .exe) from:

```
https://github.com/cloudflare/cloudflared/releases/latest
```

Put `cloudflared.exe` somewhere handy, then run:

```
cloudflared.exe tunnel --url http://localhost:8787
```

It prints a URL like:

```
https://random-words.trycloudflare.com
```

Keep that window open while browsing at school. Quick-tunnel URLs change every
time you restart it — paste the new one each time.

## 3. Point the site at it

Open the site → Settings, then set:

- **Bare server**: `https://random-words.trycloudflare.com/bare/`
- **Wisp URL**: `wss://random-words.trycloudflare.com/wisp/`

Save both. The browser page now fetches through your home connection.

## 4. Test

- `https://random-words.trycloudflare.com/health` should return JSON with `ok: true`.
- In the browser, open the proxy page, try atlantic.bz and a YouTube video.
- Optionally run `/checkall <tunnel-url>` in Discord to see if the filter flags it.

## Optional: stable URL

A named tunnel needs a free Cloudflare account (no card):

```
cloudflared tunnel login
cloudflared tunnel create af-relay
cloudflared tunnel route dns af-relay relay.YOURDOMAIN
cloudflared tunnel run af-relay --url http://localhost:8787
```

then use `https://relay.YOURDOMAIN/bare/` and `wss://relay.YOURDOMAIN/wisp/`.

## Troubleshooting

- `Decompression failed` → already fixed: the relay strips `content-encoding`
  after Node's fetch decompresses upstream bodies.
- Wisp 502 → check the tunnel is running and the URL ends in `/wisp/`.
- Site still blocked → the tunnel hostname is flagged; use DuckDNS + router
  port-forward 8787 instead, or a named tunnel on a domain you own.
