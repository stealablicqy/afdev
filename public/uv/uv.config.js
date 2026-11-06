/*global Ultraviolet*/
// Base-aware config. The hub is served from a subdirectory (CDN, or /public in
// dev), so the service prefix and every file reference are derived from this
// script's own URL instead of the origin root.
(function () {
	const scriptUrl =
		(typeof document !== "undefined" && document.currentScript && document.currentScript.src) ||
		self.location.href;
	const base = new URL("./", scriptUrl);
	const file = (name) => new URL(name, base).href;

	self.__uv$config = {
		// uv.sw.js matches location.origin + prefix, so this must stay a path.
		prefix: base.pathname + "service/",
		encodeUrl: Ultraviolet.codec.xor.encode,
		decodeUrl: Ultraviolet.codec.xor.decode,
		handler: file("uv.handler.js"),
		client: file("uv.client.js"),
		bundle: file("uv.bundle.js"),
		config: file("uv.config.js"),
		sw: file("uv.sw.js"),
	};
})();
