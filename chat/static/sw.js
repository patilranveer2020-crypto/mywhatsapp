const CACHE_NAME = 'chat-app-cache-v3';
const urlsToCache = [
  '/',
  '/static/manifest.json',
  '/static/icon-192.png',
  '/static/icon-512.png'
];

// 1. INSTALL & FORCE TAKEOVER
self.addEventListener('install', event => {
    self.skipWaiting(); // Skip the waiting room!
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

// 2. ACTIVATE & FORCE CONTROL
self.addEventListener('activate', event => {
    event.waitUntil(clients.claim()); // Take over the phone immediately!
});

// 3. FETCH (Cache)
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});

// 4. RECEIVE THE PUSH NOTIFICATION
self.addEventListener('push', function(event) {
    let data = {};
    let rawText = "";
    
    if (event.data) {
        rawText = event.data.text();
        try {
            data = JSON.parse(rawText);
        } catch(e) {
            console.log("Not JSON:", rawText);
        }
    }
    
    let targetUrl = '/';
    if (data.type === 'video_call' && data.room_url) {
        targetUrl = data.room_url;
    }

    // Print the URL on the screen so we can read it!
    let title = "Diagnostic Test";
    let options = {
        body: `Testing URL: ${targetUrl}`, 
        icon: '/static/icon-192.png',
        data: { url: targetUrl }, 
        requireInteraction: true
    };
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// 5. HANDLE THE NOTIFICATION CLICK
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    if (event.action === 'decline') {
        return; 
    }

    // 👉 THE HARDCODE TEST: Force the phone to go to this fake room!
    const targetUrl = '/videocalls/TEST-ROOM-123/?caller=0&type=video';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if ('focus' in client) {
                    return client.focus().then(c => c.navigate(targetUrl));
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});