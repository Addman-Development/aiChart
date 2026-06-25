import { getVapidKeyApi, subscribePushApi, unsubscribePushApi } from "../api/push";

// Client-side Web Push helper. All functions are best-effort and never throw to
// their callers — push is an enhancement, not a hard dependency.
//
// The settings toggle is the canonical control: enabling/disabling there both
// flips the server-side master preference and (de)registers THIS device. On
// every login we additionally call syncSubscription() to silently refresh an
// already-granted device's subscription (handles browser-side expiry/rotation).

let cachedVapidKey;

export function isPushSupported() {
  return typeof navigator !== "undefined"
    && "serviceWorker" in navigator
    && typeof window !== "undefined"
    && "PushManager" in window
    && "Notification" in window;
}

export function getPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

// Convert the URL-safe base64 VAPID key the server returns into the Uint8Array
// the PushManager expects for applicationServerKey.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Resolve the active service worker registration without hanging: in dev the SW
// is disabled, so navigator.serviceWorker.ready would never settle.
function getRegistration(timeoutMs = 4000) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => { setTimeout(() => resolve(null), timeoutMs); }),
  ]);
}

async function getVapidKey() {
  // Only cache a successful (truthy) key. Caching null/undefined would make a
  // single transient fetch failure permanently block subscribing for the page
  // session; leaving it unset lets a later gesture (toggle/login) retry.
  if (cachedVapidKey) return cachedVapidKey;
  const key = await getVapidKeyApi().catch(() => null);
  if (key) cachedVapidKey = key;
  return key;
}

// Does an existing subscription's applicationServerKey match the current server
// VAPID key? Used to detect (and re-subscribe after) a server-side key rotation.
function applicationServerKeyMatches(subscription, desiredKey) {
  try {
    const existing = subscription.options && subscription.options.applicationServerKey;
    if (!existing) return true; // browser doesn't expose it — assume ok, avoid churn
    const existingBytes = new Uint8Array(existing);
    if (existingBytes.length !== desiredKey.length) return false;
    for (let i = 0; i < desiredKey.length; i += 1) {
      if (existingBytes[i] !== desiredKey[i]) return false;
    }
    return true;
  } catch (e) {
    return true;
  }
}

async function postSubscription(subscription) {
  const json = subscription.toJSON();
  await subscribePushApi({
    endpoint: json.endpoint,
    keys: json.keys,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  });
}

// Ensure a push subscription exists on this device and is registered with the
// server. Assumes the OS permission is already granted (caller's job).
// Returns the subscription, or null when the server has push disabled.
async function ensureSubscription(registration) {
  const vapidKey = await getVapidKey();
  if (!vapidKey) return null;
  const desiredKey = urlBase64ToUint8Array(vapidKey);

  let subscription = await registration.pushManager.getSubscription();
  // If the device is subscribed under a different (rotated) VAPID key, drop it so
  // we re-subscribe with the current one — otherwise pushes silently stop working.
  if (subscription && !applicationServerKeyMatches(subscription, desiredKey)) {
    try { await subscription.unsubscribe(); } catch (e) { /* ignore */ }
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: desiredKey,
    });
  }
  await postSubscription(subscription);
  return subscription;
}

// Silent: refresh/register the subscription only when permission is already
// granted. Safe to call on every login. Never prompts, never throws.
export async function syncSubscription() {
  try {
    if (!isPushSupported() || getPermission() !== "granted") return;
    const registration = await getRegistration();
    if (!registration) return;
    await ensureSubscription(registration);
  } catch (e) {
    // best-effort
  }
}

// Explicit enable on this device — call from a user gesture; it may prompt for
// permission. Returns a status object the UI can use to message the user.
export async function enablePushOnThisDevice() {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  let permission = getPermission();
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }
  if (permission === "denied") return { ok: false, reason: "denied" };
  if (permission !== "granted") return { ok: false, reason: "dismissed" };

  const registration = await getRegistration();
  if (!registration) return { ok: false, reason: "no-sw" };

  try {
    const subscription = await ensureSubscription(registration);
    if (!subscription) return { ok: false, reason: "not-configured" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "error" };
  }
}

// Explicit disable on this device: drop the server record + the browser
// subscription. The server-side master preference is updated separately by the
// caller (so push stops on ALL devices), but we also unsubscribe locally.
export async function disablePushOnThisDevice() {
  try {
    const registration = await getRegistration();
    if (!registration) return { ok: true };
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      try { await unsubscribePushApi(subscription.endpoint); } catch (e) { /* ignore */ }
      try { await subscription.unsubscribe(); } catch (e) { /* ignore */ }
    }
    return { ok: true };
  } catch (e) {
    return { ok: true };
  }
}

// Snapshot of this device's push state for the settings UI.
export async function getDeviceStatus() {
  const supported = isPushSupported();
  const permission = supported ? getPermission() : "unsupported";
  let subscribed = false;
  if (supported && permission === "granted") {
    try {
      const registration = await getRegistration();
      if (registration) {
        const subscription = await registration.pushManager.getSubscription();
        subscribed = Boolean(subscription);
      }
    } catch (e) { /* ignore */ }
  }
  return { supported, permission, subscribed };
}
