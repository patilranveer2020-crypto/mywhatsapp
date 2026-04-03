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



self.addEventListener('install', function(event) {
    self.skipWaiting(); 
});

// 👉 2. FORCE CONTROL: Take over the phone immediately!
self.addEventListener('activate', function(event) {
    event.waitUntil(clients.claim());
});



// Listen for Push events (when the app is closed)
self.addEventListener('push', function(event) {
    let data = {};
    let rawText = "";
    
    // 1. Try to read the data from Django
    if (event.data) {
        rawText = event.data.text();
        try {
            data = JSON.parse(rawText);
        } catch(e) {
            console.log("Not JSON:", rawText);
        }
    }
    
    // 2. Figure out the URL
    let targetUrl = '/';
    if (data.type === 'video_call' && data.room_url) {
        targetUrl = data.room_url;
    }

    // 3. 👉 THE TEST: Print the URL directly on the phone screen!
    let title = "Diagnostic Test";
    let options = {
        body: `Testing URL: ${targetUrl}`, 
        icon: '/static/icon-192.png',
        data: { url: targetUrl }, // Store it for the click!
        requireInteraction: true
    };
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const targetUrl = event.notification.data ? (event.notification.data.url || '/') : '/';

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


// Listen for the user clicking the notification
self.addEventListener('notificationclick', function(event) {
    event.notification.close(); // Close the little notification
    
    // 👉 1. If they clicked your custom "Decline" button, do nothing!
    if (event.action === 'decline') {
        return; 
    }

    // 👉 2. THE FIX: Grab the hidden URL from the push data! 
    // If it's a normal message, it defaults to '/'. If it's a call, it uses the call link!
    const targetUrl = event.notification.data ? (event.notification.data.url || '/') : '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            // If the app is already open in the background, bring it to the front and change the page
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if ('focus' in client) {
                    return client.focus().then(c => c.navigate(targetUrl));
                }
            }
            // If the app was completely closed, open a brand new window straight to the call!
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});