/*
 * CS Navigator — push-only service worker.
 *
 * This worker exists ONLY to receive Web Push messages and open the app when a
 * notification is clicked. It deliberately has NO fetch handler and does NO
 * caching, so it cannot reintroduce the "stale cached app" problem that the
 * main PWA service worker (selfDestroying) was configured to avoid. It is
 * registered at scope /push/ so it never conflicts with that PWA worker.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'CS Navigator';
  const options = {
    body: data.body || '',
    icon: '/msu_logo.webp',
    badge: '/msu_logo.webp',
    tag: data.tag || 'cs-navigator',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing app tab if one is open, else open a new one.
        for (const client of clientList) {
          if ('focus' in client) {
            if ('navigate' in client) {
              client.navigate(targetUrl).catch(() => {});
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
