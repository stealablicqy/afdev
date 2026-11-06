/*global $scramjetLoadWorker*/
// Served from a CDN subdirectory, so the bundle path is resolved against this
// worker's own URL. A root-absolute "/scramjet/scramjet.all.js" 404s on a
// jsDelivr or Pages subpath and the worker never installs.
const DIR = new URL('./', self.location.href).href;

importScripts(DIR + 'scramjet.all.js?v=21');

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
	event.respondWith(scramjet.fetch(event));
});
