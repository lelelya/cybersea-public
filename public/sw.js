// sw.js — Service Worker: PWA 离线缓存 + Web Push 通知

const CACHE_NAME = 'cybersea-public-v2-original-background';
const STATIC_ASSETS = [
  "/js/shared.js",
  '/',
  '/index.html',
  '/css/style.css',
  '/js/nav.js?v=6',
  '/css/theme.css',
  '/css/design-system.css?v=2',
  '/css/navigation.css',
  '/css/navigation.css?v=5',
  '/life.html',
  '/css/life.css?v=10',
  '/images/life-bathymetry.svg?v=3',
  '/js/life-overview.js?v=2',
  '/companion.html',
  '/css/companion.css?v=11',
  '/js/hubs.js?v=3',
  '/js/companion-network.js?v=4',
  '/css/effects.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ── 安装：预缓存核心静态资源 ──
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ── 激活：清理旧缓存 ──
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── 请求拦截：缓存策略 ──
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  // API 请求走网络（不缓存）
  if (url.pathname.startsWith('/api/')) return;

  if (event.request.destination === 'style' || event.request.destination === 'script') {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
            return cache.put(event.request, copy);
          }));
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  // HTML 页面：网络优先（确保拿到最新版本）
  if (event.request.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  // 其他静态资源：缓存优先
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      return cached || fetch(event.request);
    })
  );
});

// ── Push 通知 ──
self.addEventListener('push', function(event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'CyberSea', body: '有新消息' };
  }

  var title = data.title || 'CyberSea';
  var options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: 'cybersea-push',
    requireInteraction: false,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var url = '/';
  if (event.notification.data && event.notification.data.url) {
    url = event.notification.data.url;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});






