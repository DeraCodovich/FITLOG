const CACHE='fitlog-v1';
const ASSETS=[
  '/FITLOG/fitness-tracker.html',
  '/FITLOG/manifest.json'
];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('fetch',e=>{
  e.respondWith(
    caches.match(e.request).then(r=>r||fetch(e.request).catch(()=>caches.match('/FITLOG/fitness-tracker.html')))
  );
});
