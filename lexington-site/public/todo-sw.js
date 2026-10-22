// Site to-do list: the small helper that lets Android install /todo as an app. Everything
// still comes from the internet as normal; with no signal, opening the app shows a short
// message instead of the browser's error page.
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site to-do</title><body style="margin:0;font:17px/1.45 system-ui,sans-serif;background:#f7f4ec;color:#15181a;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center">
<div><p style="font-size:22px;font-weight:700;margin:0 0 8px">No signal</p><p style="margin:0 0 16px">The site to-do list needs data to open. Try again in a moment.</p>
<button onclick="location.reload()" style="font:inherit;font-weight:700;min-height:48px;padding:0 20px;border:0;border-radius:12px;background:#15181a;color:#f7f4ec">Try again</button></div>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
  );
});
