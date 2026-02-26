const CACHE_NAME = 'chat-app-cache-v2';
const urlsToCache = [
  '/',
  '/static/manifest.json',
  '/static/icon-192.png',
  '/static/icon-512.png'
];

// Install the Service Worker and save files to the phone's memory
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Serve cached files to make the app load instantly
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});
// Listen for Push events (when the app is closed)
self.addEventListener('push', function(event) {
    let data = {};
    if (event.data) {
        data = event.data.json();
    }
    
    const title = data.title || "New Message";
    const options = {
        body: data.body || "You have a new message.",
        icon: '/static/icon-192.png',
        badge: '/static/icon-192.png',
        data: { url: '/' } // Tells the notification where to go when clicked
    };
    
    // Wake up the phone and show the notification!
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// If the user taps the notification, open the app
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});