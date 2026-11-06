/*global Ultraviolet, UVServiceWorker, __uv$config*/
// Served from a CDN subdirectory, so every path is resolved against this
// worker's own URL. Root-absolute "/uv/..." importScripts calls 404 on a
// jsDelivr or Pages subpath and the worker never installs.
const DIR = new URL('./', self.location.href).href;

importScripts(DIR + 'uv.bundle.js?v=20');
importScripts(DIR + 'uv.config.js?v=20');
importScripts(__uv$config.sw || DIR + 'uv.sw.js');

const ultraviolet = new UVServiceWorker();

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

async function handleRequest(event) {
	if (ultraviolet.route(event)) {
		return ultraviolet.fetch(event);
	}
	return fetch(event.request);
}

self.addEventListener('fetch', (event) => {
	event.respondWith(handleRequest(event));
});
