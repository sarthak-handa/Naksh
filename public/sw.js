/**
 * Naksh Service Worker
 * Handles push notifications and offline caching for the PWA.
 */

// Listen for push events
self.addEventListener("push", (event) => {
  let data = {
    title: "Naksh — ETA Alert",
    body: "Your route ETA has changed",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "naksh-default",
    data: {},
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/icon-192.png",
    tag: data.tag || "naksh-default",
    data: data.data || {},
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    actions: [
      { action: "open", title: "View Dashboard" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  // Open the dashboard
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If dashboard is already open, focus it
        for (const client of clientList) {
          if (client.url.includes("/") && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        return self.clients.openWindow("/");
      })
  );
});

// Install event — pre-cache essential assets
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Activate event — clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
