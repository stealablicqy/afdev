/*global Ultraviolet*/
// The hub is served from a CDN subdirectory, so root-absolute paths such as
// "/uv/service/" resolve to the CDN origin root and 404 before the service
// worker ever sees them. Every path below is derived from this script's own
// location: in a page it is the <script src>, in a worker it is self.location.
(function () {
  function uvDir() {
    try {
      if (typeof self !== 'undefined' && typeof self.location !== 'undefined' && !self.document) {
        return new URL('./', self.location.href).href;
      }
    } catch (e) { /* fall through to the document path */ }
    try {
      var script = (typeof document !== 'undefined') ? document.currentScript : null;
      if (!script || !script.src) {
        var list = document.getElementsByTagName('script');
        script = list[list.length - 1];
      }
      if (script && script.src) return new URL('./', script.src).href;
    } catch (e) { /* fall through to the root form */ }
    var origin = (typeof location !== 'undefined') ? location.origin : '';
    return origin + '/uv/';
  }

  // Slash-free codec. The stock XOR codec leaves %2F in the path, and a CDN
  // subpath turns those into real slashes while the worker decodes, collapsing
  // "https://" into "https:/" and 404ing the destination. base64url has no
  // slash to collapse.
  // Rotating XOR before base64url: slash-free and not a plain base64 URL.
  function encodeUrl(text) {
    if (!text) return text;
    var key = [0x5a, 0x3c, 0x6f, 0x21, 0x9b];
    var bytes = new TextEncoder().encode(String(text));
    var out = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i += 1) out[i] = bytes[i] ^ key[i % 5];
    var raw = '';
    for (var j = 0; j < out.length; j += 1) raw += String.fromCharCode(out[j]);
    return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeUrl(text) {
    if (!text) return text;
    var key = [0x5a, 0x3c, 0x6f, 0x21, 0x9b];
    var raw = String(text).replace(/-/g, '+').replace(/_/g, '/');
    var padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    var binary = atob(padded);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) ^ key[i % 5];
    return new TextDecoder().decode(out);
  }

  var dir = uvDir();                        // absolute, ends with "/uv/"
  var dirPath = new URL(dir).pathname;      // path only, ends with "/uv/"

  self.__uv$config = {
    prefix: dirPath + 'service/',           // <app root>/uv/service/
    encodeUrl: encodeUrl,
    decodeUrl: decodeUrl,
    handler: dir + 'uv.handler.js',
    client: dir + 'uv.client.js',
    bundle: dir + 'uv.bundle.js',
    config: dir + 'uv.config.js',
    sw: dir + 'uv.sw.js',
  };
})();
