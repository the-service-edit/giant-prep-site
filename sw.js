/* Giant Coffee Prep — offline shell + push notifications.
   App state lives in localStorage; the timers this worker needs are mirrored
   into IndexedDB, because a service worker cannot read localStorage. */
const CACHE = "giant-prep-v3";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./elephant.png",
  "./icon-512-maskable.png", "./apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;          // never cache the API
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put("./index.html", copy));
        return r;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => hit))
  );
});

/* ---------- tiny IndexedDB for timer mirroring ---------- */
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("giant-prep", 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("timers")) r.result.createObjectStore("timers", { keyPath: "tid" }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function allTimers() {
  return db().then(d => new Promise((res, rej) => {
    const q = d.transaction("timers", "readonly").objectStore("timers").getAll();
    q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
  })).catch(() => []);
}
function dropTimer(tid) {
  return db().then(d => new Promise(res => {
    const t = d.transaction("timers", "readwrite"); t.objectStore("timers").delete(tid);
    t.oncomplete = res; t.onerror = res;
  })).catch(() => {});
}

/* ---------- push ---------- */
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    const now = Date.now();
    const timers = await allTimers();
    const due = timers.filter(t => t.endsAt <= now + 20000);

    if (!due.length) {
      await self.registration.showNotification("Giant Prep", {
        body: "A timer has finished.", icon: "./icon-192.png", badge: "./icon-192.png",
        tag: "giant-timer", renotify: true, requireInteraction: true, vibrate: [200, 90, 200]
      });
      return;
    }
    for (const t of due) {
      await self.registration.showNotification(t.label + " — done", {
        body: t.minutes ? `${t.minutes} minute timer finished. Confirm the task yourself.`
                        : "Timer finished. Confirm the task yourself.",
        icon: "./icon-192.png", badge: "./icon-192.png",
        tag: "giant-" + t.tid, renotify: true, requireInteraction: true,
        vibrate: [200, 90, 200, 90, 350], data: { tid: t.tid }
      });
      await dropTimer(t.tid);
    }
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    if (clients.openWindow) return clients.openWindow("./");
  }));
});
