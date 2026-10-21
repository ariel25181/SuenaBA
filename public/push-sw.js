/* Notificaciones push de SuenaBA. Se carga dentro del service worker de la PWA (workbox.importScripts). */
function safeUrl(u) {
  try {
    var x = new URL(u, self.location.origin);
    return x.origin === self.location.origin || x.protocol === 'https:' ? x.href : self.location.origin + '/';
  } catch (e) { return self.location.origin + '/'; }
}

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  var title = String(data.title || 'SuenaBA').slice(0, 80);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(data.body || '').slice(0, 200),
    tag: data.tag || undefined,
    icon: 'pwa-192x192.png',
    badge: 'pwa-192x192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
