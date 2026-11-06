// Patched Rammerhead browser client.
//
// rammerhead@1.2.64 ships two localStorage implementations in the same file:
// `fixCrossWindowLocalStorage()` installs a Proxy-backed storage, and then
// `main()` goes on to run the older sync implementation, which expects
// `localStorage.addChangeEventListener()` — a method the new Proxy does not
// expose. The call throws, `main()` aborts half-finished, and every proxied
// page logs `TypeError: addChangeEventListener is not a function`.
//
// The same Proxy also turns any non-string key into a storage lookup through
// `toRealStorageKey()`, which template-stringifies the key. `String(localStorage)`
// (and any `console.log(localStorage)`) hits the `Symbol.toStringTag` getter and
// throws `Cannot convert a Symbol value to a string`.
//
// Both are upstream bugs, not configuration. The fix is applied at serve time:
// the non-minified client is read once, two anchors are rewritten, and the
// result is handed to the proxy's own `/rammerhead.js` route. Anchors are
// asserted, so a future version bump fails loudly instead of silently shipping
// an unpatched client.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const STORAGE_GET_ANCHOR = `                    get(target, prop, receiver) {
                        if (reservedProps.includes(prop) && prop !== 'length') {
                            return Reflect.get(target, prop, receiver);
                        } else if (prop === 'length') {
                            let len = 0;
                            for (const [key] of Object.entries(realStorage)) {
                                if (fromRealStorageKey(key)) len++;
                            }
                            return len;
                        } else {
                            return realStorage[toRealStorageKey(prop)];
                        }
                    },`;

const STORAGE_GET_PATCHED = `                    get(target, prop, receiver) {
                        if (typeof prop !== 'string') {
                            return Reflect.get(target, prop, receiver);
                        }
                        if (reservedProps.includes(prop) && prop !== 'length') {
                            return Reflect.get(target, prop, receiver);
                        } else if (prop === 'length') {
                            let len = 0;
                            for (const [key] of Object.entries(realStorage)) {
                                if (fromRealStorageKey(key)) len++;
                            }
                            return len;
                        } else if (prop === 'constructor' || prop in Object.prototype) {
                            return Reflect.get(target, prop, receiver);
                        } else {
                            return realStorage[toRealStorageKey(prop)];
                        }
                    },`;

const STORAGE_SET_ANCHOR = `                    set(_, prop, value) {
                        if (!reservedProps.includes(prop)) {
                            realStorage[toRealStorageKey(prop)] = value;
                        }
                        return true;
                    },`;

const STORAGE_SET_PATCHED = `                    set(_, prop, value) {
                        if (typeof prop !== 'string') return true;
                        if (!reservedProps.includes(prop)) {
                            realStorage[toRealStorageKey(prop)] = value;
                        }
                        return true;
                    },`;

const STORAGE_DELETE_ANCHOR = `                    deleteProperty(_, prop) {
                        delete realStorage[toRealStorageKey(prop)];
                        return true;
                    },`;

const STORAGE_DELETE_PATCHED = `                    deleteProperty(_, prop) {
                        if (typeof prop !== 'string') return true;
                        delete realStorage[toRealStorageKey(prop)];
                        return true;
                    },`;

const STORAGE_HAS_ANCHOR = `                    has(target, prop) {
                        return toRealStorageKey(prop) in realStorage || prop in target;
                    },`;

const STORAGE_HAS_PATCHED = `                    has(target, prop) {
                        if (typeof prop !== 'string') return Reflect.has(target, prop);
                        return toRealStorageKey(prop) in realStorage || prop in target;
                    },`;

const STORAGE_DESCRIPTOR_ANCHOR = `                    getOwnPropertyDescriptor(_, prop) {
                        return Object.getOwnPropertyDescriptor(realStorage, toRealStorageKey(prop));
                    },`;

const STORAGE_DESCRIPTOR_PATCHED = `                    getOwnPropertyDescriptor(_, prop) {
                        if (typeof prop !== 'string') return undefined;
                        return Object.getOwnPropertyDescriptor(realStorage, toRealStorageKey(prop));
                    },`;

const STORAGE_DEFINE_ANCHOR = `                    defineProperty(_, prop, desc) {
                        if (!reservedProps.includes(prop)) {
                            Object.defineProperty(realStorage, toRealStorageKey(prop), desc);
                        }
                        return true;
                    }`;

const STORAGE_DEFINE_PATCHED = `                    defineProperty(_, prop, desc) {
                        if (typeof prop !== 'string') return true;
                        if (!reservedProps.includes(prop)) {
                            Object.defineProperty(realStorage, toRealStorageKey(prop), desc);
                        }
                        return true;
                    }`;

const SYNC_ANCHOR = `        fixCrossWindowLocalStorage();`;

const SYNC_PATCHED = `        fixCrossWindowLocalStorage();

        // The storage Proxy above replaces hammerhead's storage wrapper, and it
        // has no addChangeEventListener(). The legacy sync block below calls that
        // method unconditionally, so it has to be skipped — running it aborts
        // main() with a TypeError on every proxied page. This is the flag
        // rammerhead already provides for exactly this hand-off.
        window.rammerheadDisableLocalStorageImplementation = true;`;

function replaceOnce(source, anchor, replacement, label) {
	if (!source.includes(anchor)) {
		throw new Error(`rammerhead client patch anchor missing: ${label}`);
	}
	return source.replace(anchor, replacement);
}

function buildPatchedClient() {
	const entry = require.resolve("rammerhead/src/client/rammerhead.js");
	const source = fs.readFileSync(entry, "utf8");

	let patched = source;
	patched = replaceOnce(patched, SYNC_ANCHOR, SYNC_PATCHED, "localStorage sync hand-off");
	patched = replaceOnce(patched, STORAGE_GET_ANCHOR, STORAGE_GET_PATCHED, "storage proxy get");
	patched = replaceOnce(patched, STORAGE_SET_ANCHOR, STORAGE_SET_PATCHED, "storage proxy set");
	patched = replaceOnce(patched, STORAGE_DELETE_ANCHOR, STORAGE_DELETE_PATCHED, "storage proxy deleteProperty");
	patched = replaceOnce(patched, STORAGE_HAS_ANCHOR, STORAGE_HAS_PATCHED, "storage proxy has");
	patched = replaceOnce(patched, STORAGE_DESCRIPTOR_ANCHOR, STORAGE_DESCRIPTOR_PATCHED, "storage proxy getOwnPropertyDescriptor");
	patched = replaceOnce(patched, STORAGE_DEFINE_ANCHOR, STORAGE_DEFINE_PATCHED, "storage proxy defineProperty");

	return { source: patched, entry: path.relative(process.cwd(), entry) };
}

let cached = null;

/**
 * Patched `rammerhead.js`, built once per process.
 *
 * Returns `{ body, entry }` or `{ body: null, error }`. A null body means the
 * package changed shape: the proxy then falls back to the stock route rather
 * than serving a half-patched client.
 */
export function rammerheadClient() {
	if (cached) return cached;
	try {
		const { source, entry } = buildPatchedClient();
		cached = { body: Buffer.from(source, "utf8"), entry, error: null };
	} catch (error) {
		cached = { body: null, entry: null, error: error?.message || String(error) };
	}
	return cached;
}
