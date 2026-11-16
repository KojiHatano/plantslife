'use strict';
// IndexedDB ラッパー。plants / logs / settings の3ストア。
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('plantslife', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('plants', { keyPath: 'id', autoIncrement: true });
      const l = d.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
      l.createIndex('plantId', 'plantId');
      d.createObjectStore('settings', { keyPath: 'key' });
    };
    r.onsuccess = () => { db = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
  const req = (s, m, f) => new Promise((res, rej) => {
    const t = db.transaction(s, m);
    const r = f(t.objectStore(s));
    t.oncomplete = () => res(r.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
  return {
    open,
    all: s => req(s, 'readonly', o => o.getAll()),
    put: (s, v) => req(s, 'readwrite', o => o.put(v)),
    del: (s, k) => req(s, 'readwrite', o => o.delete(k)),
    clear: s => req(s, 'readwrite', o => o.clear()),
    // 植物削除時にその植物のログも削除
    delLogsOf: pid => new Promise((res, rej) => {
      const t = db.transaction('logs', 'readwrite');
      const c = t.objectStore('logs').index('plantId').openCursor(IDBKeyRange.only(pid));
      c.onsuccess = () => { const cur = c.result; if (cur) { cur.delete(); cur.continue(); } };
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    }),
  };
})();
