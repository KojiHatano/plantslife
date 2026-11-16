'use strict';
// ネットワーク優先: 通信できるときは常に最新を取得し、オフライン時のみキャッシュを使う。
// CACHE名のバージョンは app.js の APP_VERSION と揃えること。
const CACHE = 'plantslife-v5';
const SHELL = ['./', 'index.html', 'style.css', 'db.js', 'app.js', 'manifest.webmanifest', 'fonts/DancingScript.ttf', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const TIMEOUT_MS = 4000; // 回線が不安定なときはキャッシュに切り替える

self.addEventListener('install', e => {
  // HTTPキャッシュ(Pagesのmax-age)を避けて最新を保存する
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }), // 変更があるときだけ再取得(条件付きリクエスト)
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await cache.match('./')) || (await cache.match('index.html')) || Response.error();
    return Response.error();
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(networkFirst(req));
});
