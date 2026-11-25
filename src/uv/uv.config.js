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
  function encodeUrl(text) {
    if (!text) return text;
    var bytes = new TextEncoder().encode(String(text));
    var raw = '';
    for (var i = 0; i < bytes.length; i += 1) raw += String.fromCharCode(bytes[i]);
    return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeUrl(text) {
    if (!text) return text;
    var raw = String(text).replace(/-/g, '+').replace(/_/g, '/');
    var padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
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
