const CACHE_NAME = 'chat-app-cache-v2';
const urlsToCache = [
  '/',
  '/static/manifest.json',
  '/static/icon-192.png',
  '/static/icon-512.png'
];


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
    
    let title = data.title || "New Message";
    let options = {
        body: data.body || "You have a new message.",
        icon: '/static/icon-192.png',
        badge: '/static/icon-192.png',
        data: { url: data.url || '/' } // Default fallback URL
    };

    // 👉 NEW: If Django tells us this is a video call, upgrade the notification!
    if (data.type === 'video_call') {
        title = "Incoming Video Call 🎥";
        options.body = `${data.caller_name} is calling you...`;
        options.requireInteraction = true; // Forces the notification to stay on screen until tapped
        options.vibrate = [500, 250, 500, 250, 500]; // Heavy ringing vibration pattern
        options.data.url = data.room_url; // Set the URL directly to the video room!
        options.actions = [
            { action: 'answer', title: '🟢 Answer' },
            { action: 'decline', title: '🔴 Decline' }
        ];
    }
    
    // Wake up the phone and show the notification!
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Handle when the user taps the notification or the buttons
self.addEventListener('notificationclick', function(event) {
    event.notification.close(); // Always close the popup first
    
    // 👉 NEW: If they clicked "Decline", just stop here.
    if (event.action === 'decline') {
        return; 
    }

    // If they clicked "Answer" (or just tapped the main body of the notification)
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});

// Listen for the user clicking the notification
self.addEventListener('notificationclick', function(event) {
    event.notification.close(); // Close the little notification

    // This URL will open your main app where the Ringing Screen is waiting!
    const targetUrl = '/'; 

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            // If the app is already open in the background, bring it to the front
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url.includes(targetUrl) && 'focus' in client) {
                    return client.focus();
                }
            }
            // If the app was completely closed, open it fresh!
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});