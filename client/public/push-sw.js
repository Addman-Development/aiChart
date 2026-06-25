/* eslint-disable */
// Web Push handlers for the Edison — SmartChart PWA.
//
// This file is loaded into Workbox's generated service worker via
// `workbox.importScripts: ["push-sw.js"]` (see client/vite.config.js). It runs in
// the ServiceWorkerGlobalScope, so `self`, `self.clients` and `self.registration`
// are available. Keep it dependency-free plain JS — it is copied verbatim from
// public/ and is NOT processed by the bundler.

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "Edison — SmartChart", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Edison — SmartChart";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        const isFocused = clientList.some(
          (client) => client.focused || client.visibilityState === "visible"
        );

        // The subscription is created with userVisibleOnly:true, so the Push API
        // contract requires EVERY push to show a notification — skipping it drains
        // the browser's silent-push budget and eventually revokes the subscription.
        // So we always show one, but when the app is already focused (the in-app
        // toast/bell has surfaced it) we show it SILENTLY so it isn't noisy; the
        // shared tag coalesces it with the in-app notification.
        const options = {
          body: payload.body || "",
          icon: "/pwa-192x192.png",
          badge: "/pwa-192x192.png",
          data: payload.data || {},
          tag: payload.tag || undefined,
          renotify: Boolean(payload.tag) && !isFocused,
          silent: isFocused,
        };

        return self.registration.showNotification(title, options);
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an existing app window: focus it and hand it the payload so the
        // SPA can deep-link (handled by the navigator.serviceWorker message
        // listener in the client). Only open a new window when none exists.
        const existing = clientList.find((client) => "focus" in client);
        if (existing) {
          if ("postMessage" in existing) {
            existing.postMessage({ type: "push-notification-click", data });
          }
          return existing.focus();
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
