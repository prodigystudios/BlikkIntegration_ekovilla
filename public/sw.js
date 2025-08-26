self.addEventListener('install', (event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Minimal no-op fetch handler; extend for offline cache if needed
self.addEventListener('fetch', () => {});
