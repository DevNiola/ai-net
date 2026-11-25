/* ai-net Service Worker — handles background push notifications */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'ai-net', body: 'You have a new notification', type: 'system' };

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch (e) {
    // ignore parse errors
  }

  const iconMap = {
    task_completed: '/favicon.svg',
    payment_received: '/favicon.svg',
    agent_failed: '/favicon.svg',
  };

  const icon = iconMap[data.type] || '/favicon.svg';
  const badge = '/favicon.svg';

  event.waitUntil(
    self.registration.showNotification(data.title || 'ai-net', {
      body: data.body || data.message || '',
      icon,
      badge,
      tag: data.id || 'ai-net-notification',
      data: { url: data.link || '/', type: data.type },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
