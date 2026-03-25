const CACHE_NAME = 'coswap-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/theme.css',
    '/ui.js',
    '/api.js',
    '/components.js',
    '/logo.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});
