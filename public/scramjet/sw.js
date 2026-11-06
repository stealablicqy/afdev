/*global $scramjetLoadWorker*/
// Relative import: the hub runs from a CDN subdirectory, so a root-absolute
// "/scramjet/scramjet.all.js" resolves to the CDN origin root and 404s.
importScripts("./scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
	event.respondWith(scramjet.fetch(event));
});
