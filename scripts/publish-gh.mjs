// Publishes the current tree to GitHub, turns on Pages, and purges the jsDelivr
// edge cache so the CDN picks up the new commit immediately.
//
//   node scripts/publish-gh.mjs <token>
//   GITHUB_TOKEN=<token> node scripts/publish-gh.mjs
//
// The token needs `repo` (classic) or Contents:write + Pages:write (fine-grained).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "stealablicqy";
const REPO = "afdev";
const BRANCH = "main";
const PAGES_DIR = "/public";

const token = process.argv[2] || process.env.GITHUB_TOKEN || "";
if (!token) {
	console.error("publish: no token. pass it as the first argument or set GITHUB_TOKEN.");
	process.exit(2);
}

const git = args => execFileSync("git", args, { cwd: root, stdio: "inherit" });
const api = async (route, init = {}) => {
	const res = await fetch(`https://api.github.com${route}`, {
		...init,
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"x-github-api-version": "2022-11-28",
			"user-agent": "af-hub-publish",
			...(init.headers || {}),
		},
	});
	const text = await res.text();
	let body = null;
	try { body = text ? JSON.parse(text) : null; } catch { body = text; }
	return { status: res.status, body };
};

const step = label => console.log(`\n== ${label}`);

step("push");
git(["add", "-A"]);
try {
	git(["commit", "-q", "-m", `publish: ${new Date().toISOString()}`]);
} catch {
	// nothing staged: fine, the tree is already committed
}
const remoteUrl = `https://x-access-token:${token}@github.com/${OWNER}/${REPO}.git`;
git(["push", "--force", remoteUrl, `HEAD:${BRANCH}`]);

step("pages");
const pagesBody = { build_type: "legacy", source: { branch: BRANCH, path: PAGES_DIR } };
let pages = await api(`/repos/${OWNER}/${REPO}/pages`);
if (pages.status === 404) {
	const created = await api(`/repos/${OWNER}/${REPO}/pages`, {
		method: "POST",
		body: JSON.stringify(pagesBody),
	});
	console.log(`created: ${created.status}`);
} else if (pages.status === 200) {
	const updated = await api(`/repos/${OWNER}/${REPO}/pages`, {
		method: "PUT",
		body: JSON.stringify(pagesBody),
	});
	console.log(`updated: ${updated.status}`);
} else {
	console.log(`pages lookup failed: ${pages.status} ${JSON.stringify(pages.body).slice(0, 200)}`);
}
const build = await api(`/repos/${OWNER}/${REPO}/pages/builds`, { method: "POST" });
console.log(`build queued: ${build.status}`);

step("jsdelivr purge");
const files = ["public/index.html", "public/go/index.html", "public/index.svg", "public/css/neon.css", "public/js/app.js", "public/js/stellar.js", "public/js/cloak-guard.js", "public/js/music.js"];
for (const file of files) {
	for (const ref of [BRANCH, "HEAD"]) {
		const url = `https://purge.jsdelivr.net/gh/${OWNER}/${REPO}@${ref}/${file}`;
		try {
			const res = await fetch(url);
			console.log(`${res.status} ${file}@${ref}`);
		} catch (error) {
			console.log(`ERR ${file}@${ref} ${String(error).slice(0, 80)}`);
		}
	}
}

console.log(`
site      https://${OWNER}.github.io/${REPO}/
assets    https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/public/
icon      https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/public/index.svg
`);
