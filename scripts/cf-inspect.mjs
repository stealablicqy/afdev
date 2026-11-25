// Reads the local wrangler OAuth token and reports account infrastructure that
// the proxy lanes could actually be hosted on: zones (custom domains), workers
// scripts and their routes, and Pages projects.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cfgPath = path.join(os.homedir(), "AppData", "Roaming", "xdg.config", ".wrangler", "config", "default.toml");
const cfg = fs.readFileSync(cfgPath, "utf8");
const token = /oauth_token\s*=\s*"([^"]+)"/.exec(cfg)?.[1];
const account = /account_id\s*=\s*"([^"]+)"/.exec(cfg)?.[1] || "6f03142108b067aedcc2459ad2f0f88b";
if (!token) throw new Error("no oauth token in wrangler config");

async function api(pathname) {
	const res = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
	});
	const json = await res.json();
	return { ok: json.success, errors: json.errors?.map((e) => e.message), result: json.result };
}

const zones = await api("/zones?per_page=50");
console.log("ZONES", JSON.stringify(zones.ok ? zones.result.map((z) => `${z.name} (${z.status})` ) : zones, null, 0));

const scripts = await api(`/accounts/${account}/workers/scripts`);
console.log("WORKERS", JSON.stringify(scripts.ok ? scripts.result.map((s) => s.id) : scripts, null, 0));

for (const id of scripts.ok ? scripts.result.map((s) => s.id) : []) {
	const sub = await api(`/accounts/${account}/workers/scripts/${id}/subdomain`);
	const routes = await api(`/accounts/${account}/workers/scripts/${id}/routes`);
	console.log(
		"WORKER",
		id,
		"subdomain=",
		JSON.stringify(sub.result?.enabled ?? null),
		"routes=",
		JSON.stringify((routes.result || []).map((r) => r.pattern))
	);
}

const pages = await api(`/accounts/${account}/pages/projects`);
console.log("PAGES", JSON.stringify(pages.ok ? pages.result.map((p) => `${p.name} -> ${p.subdomain}`) : pages, null, 0));

const tokenState = await api("/user/tokens/verify");
console.log("TOKEN", JSON.stringify(tokenState.ok ? tokenState.result.status : tokenState.errors));
