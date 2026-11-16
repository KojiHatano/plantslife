'use strict';
// キャッシュ優先。アプリの更新は「データ」画面の更新ボタンを押したときだけ行う(app.js の updateApp)。
// 注意: このファイルは原則変更しないこと。変更するとブラウザが裏で自動更新する。
//       ファイルを追加した場合のみ SHELL に追記する(その場合は自動更新が1回走る)。
const CACHE = 'plantslife-app';
const SHELL = ['./', 'index.html', 'style.css', 'db.js', 'app.js', 'manifest.webmanifest', 'fonts/DancingScript.ttf', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  // HTTPキャッシュ(Pagesのmax-age)を避けて、その時点の最新を保存する
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
