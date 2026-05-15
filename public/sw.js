self.addEventListener('install', (event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  const title = payload?.title || 'Notis';
  const options = {
    body: payload?.body || '',
    tag: payload?.tag || undefined,
    data: {
      url: payload?.url || '/',
      noteId: payload?.noteId || null,
      reminderAt: payload?.reminderAt || null,
    },
    icon: '/favicon-192.png',
    badge: '/favicon-192.png',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});

// Minimal no-op fetch handler; extend for offline cache if needed
self.addEventListener('fetch', () => {});
