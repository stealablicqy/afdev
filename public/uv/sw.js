/*global Ultraviolet, UVServiceWorker, __uv$config*/
// Relative imports keep the worker valid under a CDN subdirectory. The SW lives
// at <base>/uv/sw.js, so every sibling resolves with "./".
importScripts("./uv.bundle.js");
importScripts("./uv.config.js");
importScripts(__uv$config.sw || "./uv.sw.js");

const ultraviolet = new UVServiceWorker();

self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

async function handleRequest(event) {
	if (ultraviolet.route(event)) {
		return ultraviolet.fetch(event);
	}
	return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});
