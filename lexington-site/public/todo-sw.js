// The site app's helper on the phone (scope /todo). Android needs one to install /todo as an app, and the phone
// alerts (further down) come through it.
//
// Since 27 Nov 2026 it also keeps a copy of the app on the phone (Niko: "Is it possible that it can open the last
// saved version thats stored on the phone offline so i can use it immediately while it restores the connection?" and
// "today my network was off so i couldn't take roll call and i don't want that to happen again"):
// - Each app page (/todo, /todo/rollcall, ...) as it last came from the website, stamped with when it was saved
//   (<meta name="todo-saved-at">, read by components/todo/phoneCopy.ts). Opening the app shows it straight away,
//   signal or not, and the part on screen asks for its figures at once. A page is fetched again quietly once it's 20
//   minutes old, and at once when the website's answers say a newer version of the app is out (x-app-build, from
//   next.config.ts): the open app then reloads itself at a quiet moment. An address with a question mark (a phone
//   alert's link) still comes from the website first.
// - The app's code, fonts and icons, and the roll call's own page (public/todo/rollcall.html and its shim, which keeps
//   the register and the marks made with no signal on the phone itself).
// - Each part's last figures (/api/todo, /api/store, ...), shown when a part is opened with no signal.
// Signed out (the website answers 401, or a page comes back as the sign-in page): the pages and figures go. Nothing is
// kept from a development server (x-app-build "dev"), so working on the app never meets an old copy.
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site app</title><body style="margin:0;font:17px/1.45 system-ui,sans-serif;background:#f7f4ec;color:#15181a;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center">
<div><p style="font-size:22px;font-weight:700;margin:0 0 8px">No signal</p><p style="margin:0 0 16px">The app needs data the first time it opens on this phone. Try again in a moment.</p>
<button onclick="location.reload()" style="font:inherit;font-weight:700;min-height:48px;padding:0 20px;border:0;border-radius:12px;background:#15181a;color:#f7f4ec">Try again</button></div>`;

const PAGES = "todo-pages-v2";
const FILES = "todo-files-v2";
const DATA = "todo-data-v2";
const LOOK_AGAIN_MS = 20 * 60 * 1000;
const MAX_PAGES = 40;
const MAX_FILES = 600;
// The roll call's own page and its shim: no version in their names, so looked at again each time they're used.
const SHELL_FILES = ["/todo/rollcall.html", "/todo/rollcall-shim.js"];
// Pages that are changed in place (the as-built record, Site updates): only ever as the website has them now.
const LIVE_ONLY = ["/todo/asbuilt", "/todo/updates"];
// The parts' figures (components/todo/SiteApp.tsx load()): the last answer of each is kept.
const DATA_PATHS = new Set([
  "/api/todo",
  "/api/store",
  "/api/expenses",
  "/api/alerts",
  "/api/concrete",
  "/api/buyers",
  "/api/steel",
  "/api/suppliers",
  "/api/spending",
  "/api/orders",
  "/api/cashflow",
  "/api/analysis",
  "/api/filings",
  "/api/site-visits",
  "/api/crm",
]);

const here = self.location.origin;
const clean = (pathname) => pathname.replace(/\/+$/, "") || "/";
const isApp = (pathname) => pathname === "/todo" || pathname.startsWith("/todo/");
const buildOf = (res) => res.headers.get("x-app-build") || "";
// From the live website (or a production build being tested), never from a development server.
const released = (res) => !!buildOf(res) && buildOf(res) !== "dev";
const offlineNote = () => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } });

let newest = ""; // the newest version of the app the website has mentioned since this helper started
const dataHash = new Map(); // a part's figures as last kept (so an unchanged answer isn't written again)
const fetching = new Map(); // a page being fetched again -> its promise

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith("todo-") && ![PAGES, FILES, DATA].includes(name)) await caches.delete(name);
      await self.clients.claim();
    })()
  )
);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== here) return;
  const path = url.pathname;
  if (SHELL_FILES.includes(path) || /^\/todo\/[\w-]+\.png$/.test(path)) return event.respondWith(file(event, req, false));
  if (req.mode === "navigate") {
    if (isApp(path)) event.respondWith(page(event, url));
    return;
  }
  if (path.startsWith("/_next/static/")) return event.respondWith(file(event, req, true));
  if (path.startsWith("/api/")) return event.respondWith(api(event, url));
});

/* ---------- the app's pages ---------- */

async function page(event, url) {
  const key = here + clean(url.pathname);
  let cache = null;
  let saved = null;
  try {
    cache = await caches.open(PAGES);
    if (!LIVE_ONLY.includes(clean(url.pathname))) saved = await cache.match(key, { ignoreVary: true });
  } catch {
    /* no room for copies on this phone: straight to the website */
  }
  // The copy on the phone, at once (and fetched again quietly when it's old).
  if (saved && !url.search) {
    event.waitUntil((ledFrom ? noteLead(key) : Promise.resolve()).then(() => lookAgain(key, saved)));
    return answer(saved);
  }
  try {
    const res = await fetch(event.request);
    if (!url.search && !LIVE_ONLY.includes(clean(url.pathname))) {
      // Leads elsewhere (the browser follows at once): the page it lands on notes it, so next time it's at once too.
      if (res.type === "opaqueredirect") ledFrom = { key, at: Date.now() };
      else event.waitUntil(keepPage(key, res.clone()).then((kept) => kept && noteLead(key)));
    }
    return res;
  } catch (error) {
    // No signal: this page's copy (a phone alert's link opens the part as it was), else the last page kept.
    if (saved) return answer(saved);
    const last = cache ? await lastPage(cache) : null;
    return last ? Response.redirect(last, 302) : offlineNote();
  }
}

let ledFrom = null; // an address that just led elsewhere: { key, at }

/** The page just kept was where another address led (the storekeeper's /todo is the store): noted for next time. */
async function noteLead(toKey) {
  const from = ledFrom;
  ledFrom = null;
  if (!from || from.key === toKey || Date.now() - from.at > 10000) return;
  try {
    const cache = await caches.open(PAGES);
    const kept = await cache.match(toKey, { ignoreVary: true });
    if (!kept) return;
    const headers = { "x-todo-goes-to": new URL(toKey).pathname, "x-saved-at": new Date().toISOString(), "x-app-build": buildOf(kept) };
    await cache.put(from.key, new Response("", { headers }));
  } catch {
    /* asked again next time */
  }
}

/** A saved page, or where the address leads for this login (the storekeeper's /todo is the store). */
function answer(saved) {
  const to = saved.headers.get("x-todo-goes-to");
  return to ? Response.redirect(here + to, 302) : saved;
}

async function lastPage(cache) {
  let best = null;
  let bestAt = "";
  for (const req of await cache.keys()) {
    const res = await cache.match(req, { ignoreVary: true });
    if (!res || res.headers.get("x-todo-goes-to")) continue;
    const at = res.headers.get("x-saved-at") || "";
    if (at > bestAt) {
      bestAt = at;
      best = req.url;
    }
  }
  return best;
}

async function lookAgain(key, saved) {
  const at = Date.parse(saved.headers.get("x-saved-at") || "") || 0;
  if (Date.now() - at > LOOK_AGAIN_MS || (newest && buildOf(saved) !== newest)) await fetchAgain(key);
}

/** The page fetched again from the website and kept (once at a time per address). */
function fetchAgain(key) {
  if (!fetching.has(key)) fetching.set(key, fetchPage(key).finally(() => fetching.delete(key)));
  return fetching.get(key);
}

async function fetchPage(key) {
  let res;
  try {
    res = await fetch(key, { cache: "no-store", redirect: "follow", credentials: "same-origin" });
  } catch {
    return false;
  }
  if (!res.redirected) return keepPage(key, res);
  // The address leads elsewhere for this login: that page is kept, and a note of where this one goes.
  const to = new URL(res.url);
  if (to.origin !== here || !isApp(to.pathname)) return false;
  const toKey = here + clean(to.pathname);
  if (toKey === key) return keepPage(key, res);
  const kept = await keepPage(toKey, res);
  if (kept) {
    try {
      const note = new Response("", { headers: { "x-todo-goes-to": clean(to.pathname), "x-saved-at": new Date().toISOString(), "x-app-build": buildOf(res) } });
      await (await caches.open(PAGES)).put(key, note);
    } catch {
      /* no room: it's asked again next time */
    }
  }
  return kept;
}

/** A page from the website, kept with the time it was saved; the sign-in page means nothing may stay. */
async function keepPage(key, res) {
  try {
    if (res.status !== 200 || !released(res) || !(res.headers.get("content-type") || "").includes("text/html")) return false;
    const html = await res.text();
    // Not the app (the sign-in page, or a login that opens nothing): signed out on this phone.
    if (!html.includes('data-app="site"')) {
      await signedOut();
      return false;
    }
    const at = new Date().toISOString();
    const headers = new Headers(res.headers);
    for (const h of ["content-length", "content-encoding", "transfer-encoding", "vary"]) headers.delete(h);
    headers.set("x-saved-at", at);
    const stamped = html.replace(/<head([^>]*)>/i, `<head$1><meta name="todo-saved-at" content="${at}">`);
    const cache = await caches.open(PAGES);
    await cache.put(key, new Response(stamped, { status: 200, headers }));
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(old);
    return true;
  } catch {
    return false;
  }
}

/* ---------- the app's code, fonts, icons and the roll call's page ---------- */

const keepable = (res, versioned) =>
  res.ok && res.type === "basic" && (versioned ? /immutable/.test(res.headers.get("cache-control") || "") : released(res));

async function file(event, req, versioned) {
  // By address alone: a piece of code's name already says which version it is (a ?dpl= tag adds nothing).
  const key = here + new URL(req.url).pathname;
  let cache = null;
  try {
    cache = await caches.open(FILES);
    const hit = await cache.match(key, { ignoreVary: true });
    if (hit) {
      // A name without a version can change with a new version of the app: looked at again quietly, for next time.
      if (!versioned) event.waitUntil(refreshFile(cache, key));
      return hit;
    }
  } catch {
    /* no room for copies: from the website */
  }
  const res = await fetch(req);
  if (cache && keepable(res, versioned)) event.waitUntil(putFile(cache, key, res.clone()));
  return res;
}

async function refreshFile(cache, key) {
  try {
    const res = await fetch(key, { cache: "no-cache" });
    if (keepable(res, false)) await cache.put(key, res);
    else if (res.ok) await cache.delete(key);
  } catch {
    /* no signal: the copy stays */
  }
}

let filesPut = 0;
async function putFile(cache, key, res) {
  try {
    const names = key.startsWith(`${here}/_next/static/`) ? await keepPiece(cache, key, res) : (await cache.put(key, res), []);
    // Older versions' code piles up: the oldest goes once there's a lot.
    if (++filesPut % 50 === 0) {
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) await cache.delete(old);
    }
    await follow(names);
  } catch {
    /* no room: fine */
  }
}

// The app's code names the other pieces it can load later (each part's code, a sheet's): those are kept too, so a part
// never opened with signal still opens with none (27 Nov 2026: the to-do list's code came in two pieces, and the second,
// tiny one was only ever fetched the first time the list itself opened). All of it is about 2.4 MB.
const PIECE = /["'](?:\/_next\/)?(static\/(?:immutable\/)?(?:chunks|media)\/[\w.~-]+\.(?:js|css|woff2?))["']/g;
const piecesIn = (text) => [...new Set([...text.matchAll(PIECE)].map((m) => `${here}/_next/${m[1]}`))];

/** A piece of code kept with the names of the pieces it can load (so they're known without reading it again). */
async function keepPiece(cache, url, res) {
  if (!/\.js$/.test(new URL(url).pathname)) {
    await cache.put(url, res);
    return [];
  }
  const text = await res.text();
  const names = piecesIn(text);
  const headers = new Headers(res.headers);
  for (const h of ["content-length", "content-encoding", "transfer-encoding"]) headers.delete(h);
  headers.set("x-pieces", names.join(" "));
  await cache.put(url, new Response(text, { status: res.status, statusText: res.statusText, headers }));
  return names;
}

const followed = new Set();
const toFetch = [];
let fetchingPieces = null;
function follow(urls) {
  for (const url of urls) {
    if (followed.has(url)) continue;
    followed.add(url);
    toFetch.push(url);
  }
  if (!fetchingPieces && toFetch.length) fetchingPieces = fetchPieces().finally(() => (fetchingPieces = null));
  return fetchingPieces || Promise.resolve();
}
async function fetchPieces() {
  const cache = await caches.open(FILES);
  while (toFetch.length) {
    const url = toFetch.shift();
    try {
      const kept = await cache.match(url, { ignoreVary: true });
      if (kept) {
        // Kept by an earlier helper: the names it was kept with (read through once if it has none).
        const names = kept.headers.has("x-pieces") ? (kept.headers.get("x-pieces") || "").split(" ").filter(Boolean) : await keepPiece(cache, url, kept);
        follow(names);
        continue;
      }
      const res = await fetch(url);
      if (keepable(res, true)) follow(await keepPiece(cache, url, res));
    } catch {
      /* no signal: kept the next time it's used */
    }
  }
}

/* ---------- the website's answers: figures kept, a newer version noticed, signed out ---------- */

async function api(event, url) {
  const res = await fetch(event.request);
  // Signed out: the copies go before the app hears it (it then opens the sign-in, never a copy).
  if (res.status === 401) await signedOut();
  else if (released(res)) {
    event.waitUntil(noteVersion(buildOf(res)));
    if (res.ok && !url.search && DATA_PATHS.has(url.pathname)) event.waitUntil(keepData(url.pathname, res.clone()));
  }
  return res;
}

async function keepData(path, res) {
  try {
    const body = await res.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", body)), (b) => b.toString(16).padStart(2, "0")).join("");
    if (dataHash.get(path) === hash) return;
    dataHash.set(path, hash);
    const headers = { "Content-Type": res.headers.get("content-type") || "application/json", "x-saved-at": new Date().toISOString(), "x-app-build": buildOf(res) };
    await (await caches.open(DATA)).put(here + path, new Response(body, { headers }));
  } catch {
    /* no room: the part just can't open with no signal */
  }
}

/** A newer version of the app is out: the pages open now (and the start page) are fetched again, the others go (they
 * come back the next time they're opened), the roll call's page too; then the open app reloads at a quiet moment. */
async function noteVersion(build) {
  if (!build || build === newest) return;
  newest = build;
  try {
    const cache = await caches.open(PAGES);
    const old = [];
    for (const req of await cache.keys()) {
      const res = await cache.match(req, { ignoreVary: true });
      if (res && buildOf(res) !== build) old.push(req.url);
    }
    if (!old.length) return;
    const wanted = new Set([here + "/todo"]);
    for (const c of await self.clients.matchAll({ type: "window" })) {
      const u = new URL(c.url);
      if (isApp(u.pathname)) wanted.add(here + clean(u.pathname));
    }
    for (const k of old) if (!wanted.has(k)) await cache.delete(k);
    const files = await caches.open(FILES);
    await Promise.all(SHELL_FILES.map((p) => refreshFile(files, here + p)));
    let fresh = false;
    for (const k of old) if (wanted.has(k)) fresh = (await fetchAgain(k)) || fresh;
    if (fresh) for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "todo-update" });
  } catch {
    /* tried again with the next answer from a newer version */
    newest = "";
  }
}

/** Signed out: nothing of the login stays (the roll call's unsent marks stay, under their own login, in the page's storage). */
async function signedOut() {
  dataHash.clear();
  // Only when there was a copy to drop does the open app go to the sign-in itself (a phone without one, or a development
  // server, carries on as before: the part says "You've been signed out").
  const had = await Promise.all(
    [PAGES, DATA].map(async (name) => (await caches.has(name)) && (await (await caches.open(name)).keys()).length > 0)
  ).catch(() => [false]);
  await Promise.all([caches.delete(PAGES), caches.delete(DATA)]).catch(() => {});
  if (!had.some(Boolean)) return;
  for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "todo-signed-out" });
}

/* ---------- the app keeps what it loaded before this helper was in charge (the first time) ---------- */

self.addEventListener("message", (event) => {
  const d = event.data;
  if (d && d.type === "todo-keep" && Array.isArray(d.urls)) event.waitUntil(keepLoaded(d.urls, event.source));
});

async function keepLoaded(urls, client) {
  try {
    const files = await caches.open(FILES);
    const code = [];
    // The app's code: kept, with every piece it can load later.
    for (const u of urls.slice(0, 400)) {
      try {
        const url = new URL(u, here);
        if (url.origin === here && url.pathname.startsWith("/_next/static/")) code.push(url.origin + url.pathname);
      } catch {
        /* not an address */
      }
    }
    // The roll call's own page and shim, whether or not this page has opened them yet (they open in a frame).
    for (const p of SHELL_FILES) {
      const key = here + p;
      if (await files.match(key, { ignoreVary: true })) continue;
      try {
        const res = await fetch(key);
        if (keepable(res, false)) await files.put(key, res);
      } catch {
        /* no signal: kept the next time it's used */
      }
    }
    await follow(code);
    // The page itself, if it isn't kept yet (it came before this helper was in charge). Never from a development server.
    if (newest && client && typeof client.url === "string") {
      const u = new URL(client.url);
      const key = here + clean(u.pathname);
      if (isApp(u.pathname) && !(await (await caches.open(PAGES)).match(key, { ignoreVary: true }))) await fetchAgain(key);
    }
  } catch {
    /* no room for copies */
  }
}

// Phone alerts for the office (23 Oct 2026, instead of emails), and since 27 Oct 2026 for the
// foreman too (a new job from the office): every push shows a notification (an iPhone stops
// sending them to an app that stays silent), and the icon shows the office's unread count. A job's
// photo shows with it where the phone can (Android), only ever from the website's own image store.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const image = typeof data.image === "string" && data.image.startsWith("https://cdn.sanity.io/") ? data.image : undefined;
  const shown = self.registration.showNotification(data.title || "The Lexington", {
    body: data.body || "Open the app to see it.",
    tag: data.tag || undefined,
    icon: "/todo/icon-192.png",
    badge: "/todo/icon-192.png",
    ...(image ? { image } : {}),
    data: { url: typeof data.url === "string" && data.url.startsWith("/todo") ? data.url : "/todo/alerts" },
  });
  const badge = typeof data.unread === "number" && self.navigator.setAppBadge ? self.navigator.setAppBadge(data.unread).catch(() => {}) : null;
  event.waitUntil(Promise.all([shown, badge]));
});

// A tap opens the alert (or the job) in the app: the open app if there is one, else a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/todo/alerts", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of open) {
        if (new URL(client.url).pathname.startsWith("/todo") && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
