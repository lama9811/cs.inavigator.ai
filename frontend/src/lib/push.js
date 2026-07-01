// Browser Web Push helpers for CS Navigator deadline reminders.
//
// Uses a dedicated push-only service worker registered at scope /push/ so it
// never collides with the app's self-destroying PWA service worker. All calls
// are no-ops / throw friendly errors when the browser or server doesn't support
// push, so callers can surface a clean message.

import { getApiBase } from "./apiBase";

const SW_URL = "/push/push-sw.js";
const SW_SCOPE = "/push/";

export function pushSupported() {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function authHeaders() {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// VAPID applicationServerKey arrives base64url; the browser needs a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function getVapidPublicKey() {
  const res = await fetch(`${getApiBase()}/api/push/vapid-public-key`);
  if (!res.ok) throw new Error("Couldn't load push configuration from the server.");
  const data = await res.json();
  if (!data.configured || !data.publicKey) {
    throw new Error("Push notifications aren't configured on the server yet.");
  }
  return data.publicKey;
}

// Wait until a freshly-registered worker is active (our SW calls skipWaiting +
// clients.claim, so this resolves quickly). We can't use
// navigator.serviceWorker.ready because that waits for the worker controlling
// THIS page, and our /push/ worker intentionally controls nothing.
function waitUntilActive(reg) {
  if (reg.active) return Promise.resolve(reg);
  return new Promise((resolve) => {
    const worker = reg.installing || reg.waiting;
    if (!worker) return resolve(reg);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") resolve(reg);
    });
    return undefined;
  });
}

export async function getPushState() {
  if (!pushSupported()) {
    return { supported: false, enabled: false, permission: "unsupported" };
  }
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, enabled: !!sub, permission: Notification.permission };
}

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error("This browser doesn't support notifications.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked. Enable them for this site in your browser settings."
        : "Notification permission wasn't granted."
    );
  }

  const publicKey = await getVapidPublicKey();
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  await waitUntilActive(reg);

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = sub.toJSON();
  const res = await fetch(`${getApiBase()}/api/push/subscribe`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  if (!res.ok) throw new Error("Couldn't save your subscription on the server.");
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (!reg) return true;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const json = sub.toJSON();
    // Tell the server first (best effort), then unsubscribe locally.
    await fetch(`${getApiBase()}/api/push/unsubscribe`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys || {} }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return true;
}

export async function sendTestPush() {
  const res = await fetch(`${getApiBase()}/api/push/test`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    let detail = "Test notification failed.";
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      /* keep default */
    }
    throw new Error(detail);
  }
  return res.json();
}
