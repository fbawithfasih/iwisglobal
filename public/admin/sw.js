// Service worker for the admin Home Screen app: shows a phone alert when the server
// pushes one (src/lib/webPush.ts) and opens the right chat when it is tapped.
self.addEventListener('push', (event) => {
  let m = { title: 'IWIS Admin', body: '', url: '/admin/whatsapp' };
  try {
    m = { ...m, ...event.data.json() };
  } catch {}
  event.waitUntil(self.registration.showNotification(m.title, { body: m.body, tag: m.tag, data: { url: m.url }, icon: '/icon-192.png' }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/admin/whatsapp', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin + '/admin') && 'focus' in c) {
          return c.navigate(target).then((w) => (w || c).focus());
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
