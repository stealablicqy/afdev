(() => {
  'use strict';
  const PREFIX = 'afhub.v1.';
  const memory = new Map();
  const jsonStore = {
    get(key, fallback) {
      try { const raw = localStorage.getItem(PREFIX + key); return raw == null ? fallback : JSON.parse(raw); }
      catch { return memory.has(key) ? memory.get(key) : fallback; }
    },
    set(key, value) {
      memory.set(key, value);
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
      catch { return false; }
    },
    remove(key) { memory.delete(key); try { localStorage.removeItem(PREFIX + key); } catch {} },
    exportAll() {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(PREFIX)) out[key.slice(PREFIX.length)] = jsonStore.get(key.slice(PREFIX.length), null);
      }
      return out;
    },
    importAll(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid backup file');
      for (const [key, value] of Object.entries(data)) {
        if (!/^[a-zA-Z0-9_-]{1,50}$/.test(key)) continue;
        jsonStore.set(key, value);
      }
    }
  };

  const DB_NAME = 'afhub-local-library';
  const DB_VERSION = 1;
  let dbPromise;
  function openDB() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('This browser does not support local media storage.'));
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open local library'));
    });
    return dbPromise;
  }
  async function audioRequest(mode, operation) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audio', mode);
      const store = tx.objectStore('audio');
      let req;
      try { req = operation(store); } catch (err) { reject(err); return; }
      tx.oncomplete = () => resolve(req ? req.result : true);
      tx.onerror = () => reject(tx.error || new Error('Local audio operation failed'));
      tx.onabort = () => reject(tx.error || new Error('Local audio operation was cancelled'));
      if (req) req.onerror = () => reject(req.error || new Error('Local audio operation failed'));
    });
  }
  const audioStore = {
    put(item) { return audioRequest('readwrite', store => store.put(item)); },
    get(id) { return audioRequest('readonly', store => store.get(id)); },
    delete(id) { return audioRequest('readwrite', store => store.delete(id)); },
    all() { return audioRequest('readonly', store => store.getAll()); }
  };

  window.AFStore = { ...jsonStore, audio: audioStore };
  window.AFUtil = {
    esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); },
    id(prefix = 'item') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; },
    safeUrl(raw) {
      try {
        const u = new URL(String(raw).trim());
        if (!['http:', 'https:'].includes(u.protocol)) return null;
        if (u.username || u.password) return null;
        return u.href;
      } catch { return null; }
    },
    host(raw) { try { return new URL(raw).hostname.replace(/^www\./, ''); } catch { return ''; } },
    fmtTime(seconds) { if (!Number.isFinite(seconds) || seconds < 0) return '0:00'; const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60); return `${m}:${String(s).padStart(2, '0')}`; }
  };
})();
