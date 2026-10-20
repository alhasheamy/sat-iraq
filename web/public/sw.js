// v3 (إزالة صور غير Esri وإضافة قوائم الدقة): نفس السياسات، data/*.json وrtl.js = stale-while-revalidate، /assets/* = كاش أولًا (ملفات مُبصَمة)، التنقّل = الشبكة أولًا مع نسخة احتياطية دون اتصال
const DATA = 'data-v4', SHELL = 'shell-v4';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png']).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![DATA, SHELL].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
const swr = (e, name) => e.respondWith(caches.open(name).then(async (c) => {
  const hit = await c.match(e.request);
  const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
  return hit || net;
}));
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/data/') || u.pathname === '/rtl.js') return swr(e, DATA);
  if (u.pathname.startsWith('/assets/') || u.pathname.startsWith('/icons/')) return e.respondWith(caches.open(SHELL).then(async (c) => (await c.match(r)) || fetch(r).then((x) => { if (x.ok) c.put(r, x.clone()); return x; })));
  if (r.mode === 'navigate') e.respondWith(fetch(r).then((x) => { if (x.ok) caches.open(SHELL).then((c) => c.put('/', x.clone())); return x; }).catch(() => caches.match('/')));
});
