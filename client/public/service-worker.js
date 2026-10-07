const CACHE_NAME = 'sequencepang-v35';

const CORE_ASSETS = [
  '/manifest.webmanifest',
  '/sequencepang-logo.png?v=melon-2',
  '/icon-192.png?v=melon-2',
  '/icon-512.png?v=melon-2',
  '/maskable-icon-512.png?v=melon-2',
  '/apple-touch-icon.png?v=melon-2',
  '/favicon-32.png?v=melon-2',
  '/favicon.ico?v=melon-2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);

  // PWA 설치 이름/아이콘은 오래 캐시되면 이전 앱 이름이 계속 노출될 수 있다.
  // manifest는 항상 최신 네트워크 버전을 우선하고, 오프라인일 때만 캐시를 사용한다.
  if (
    requestUrl.origin === self.location.origin &&
    requestUrl.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(() => caches.match('/manifest.webmanifest'))
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
