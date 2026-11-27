// Site roll call inside the Lexington app (30 Oct 2026). The roll call page was made as a Claude page and
// asks for a database, a photo store and a downloads helper (window.claude.use). Here the website answers the
// same calls: /api/rollcall (what this login may see and save) and /api/rollcall/photo. A copy is kept on the
// phone, so the page opens at once and still shows the register with a weak signal; each change since is
// fetched every few seconds while it's open.
//
// No signal (27 Nov 2026, Niko: "today my network was off so i couldn't take roll call and i don't want that to
// happen again"): the register opens from the phone's copy straight away, without waiting for the website, and
// every change is first written down on the phone (the outbox, one per login) and shown at once. The changes go to
// the website in the order they were made as soon as it can be reached, even after the app was closed and opened
// again. Sending a change twice does no harm (the website merges it into the record the same way, and a mark keeps
// the time it was tapped), so one that may or may not have arrived is simply sent again.
(() => {
  window.__rcShim = true;
  const CACHE = "rollcall-v1:";
  const OUTBOX = "rollcall-outbox:";
  const SEEN = "rollcall-seen";
  const store = new Map(); // "days/2026-11-02" -> { data, rev }: the records as the website last sent them
  let outbox = []; // [{ n, path, op, data, at, tries, kept }]: changes made on this phone the website hasn't saved yet
  const gone = new Set(); // changes this page has seen saved (or refused), so another window's list doesn't bring them back
  const waiting = new Map(); // n -> the page's save, waiting to hear how it went
  const colSubs = new Map();
  const docSubs = new Map();
  let cursor = "";
  let me = null;
  let confirmed = false; // the website has said who is signed in (a copy opened with no signal hasn't yet)
  let noSignal = false;
  let misses = 0;
  let seenAt = null; // when the website last answered
  let settle;
  const ready = new Promise((resolve, reject) => (settle = { resolve, reject }));

  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const colOf = (path) => path.split("/")[0];
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  // The website's own merge (lib/rollcall/server.ts deepMerge): objects merge field by field; anything else (null too) replaces.
  const merge = (t, p) => {
    for (const k of Object.keys(p)) {
      const v = p[k];
      t[k] = isObj(v) ? merge(isObj(t[k]) ? t[k] : {}, v) : v;
    }
    return t;
  };

  /* ---------- what the page sees: the website's records with this phone's unsent changes on top ---------- */
  const view = (path) => {
    const d = store.get(path);
    let data = d ? clone(d.data) : undefined;
    for (const c of outbox) if (c.path === path) data = merge(data || {}, clone(c.data));
    return data;
  };
  const snapDoc = (path) => {
    const pending = outbox.some((c) => c.path === path);
    const exists = store.has(path) || pending;
    return { id: path.split("/").pop(), exists, data: () => (exists ? view(path) : undefined), metadata: { hasPendingWrites: pending } };
  };
  const snapCol = (col) => {
    const paths = new Set([...store.keys()].filter((k) => colOf(k) === col));
    for (const c of outbox) if (colOf(c.path) === col) paths.add(c.path);
    const docs = [...paths].sort().map(snapDoc);
    const pending = outbox.some((c) => colOf(c.path) === col);
    return { docs, size: docs.length, empty: !docs.length, metadata: { hasPendingWrites: pending }, docChanges: () => [] };
  };
  const notify = (cols) => {
    for (const col of cols) for (const cb of colSubs.get(col) || []) cb(snapCol(col));
    for (const [path, cbs] of docSubs) if (cols.has(colOf(path))) for (const cb of cbs) cb(snapDoc(path));
  };
  // Records from the website: newer versions replace the copy; the same version again (asked from the same second) is skipped.
  const apply = (docs) => {
    const cols = new Set();
    for (const d of docs || []) {
      if (!d || !d.col) continue;
      const path = d.col + "/" + d.key;
      if (d.at && d.at > cursor) cursor = d.at;
      const cur = store.get(path);
      if (cur && cur.rev === d.rev) continue;
      store.set(path, { data: d.data, rev: d.rev });
      cols.add(d.col);
    }
    return cols;
  };

  /* ---------- the copy on this phone: one login, one set of parts ---------- */
  const keyFor = (m) => CACHE + m.id + ":" + (m.sections || []).join(",");
  // Every copy but one goes (and with no exception, all of them: signed out). The unsent changes are never touched here.
  const forget = (except) => {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE) && k !== except && !(except && k === CACHE + "last")) localStorage.removeItem(k);
      }
    } catch (e) {}
  };
  let saveT;
  const saveCopy = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!me || !confirmed) return;
      try {
        const docs = [...store].map(([p, d]) => ({ col: colOf(p), key: p.slice(p.indexOf("/") + 1), rev: d.rev, data: d.data }));
        const copy = { v: 1, me, cdn: window.__rcCdn, locations: window.__rcLocations || [], links: window.__rcLinks || [], cursor, docs };
        localStorage.setItem(keyFor(me), JSON.stringify(copy));
        localStorage.setItem(CACHE + "last", keyFor(me));
      } catch (e) {}
    }, 800);
  };
  const readCopy = (key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key) || "null");
      return c && c.v === 1 && c.me && c.me.id ? c : null;
    } catch (e) {
      return null;
    }
  };
  const lastCopy = () => {
    try {
      const last = localStorage.getItem(CACHE + "last");
      return last ? readCopy(last) : null;
    } catch (e) {
      return null;
    }
  };
  let seenSaved = 0;
  const heard = () => {
    seenAt = new Date().toISOString();
    if (Date.now() - seenSaved < 60000) return;
    seenSaved = Date.now();
    try {
      localStorage.setItem(SEEN, seenAt);
    } catch (e) {}
  };

  /* ---------- the outbox: written down on the phone before anything is sent ---------- */
  const readOutbox = (id) => {
    try {
      const o = JSON.parse(localStorage.getItem(OUTBOX + id) || "[]");
      return Array.isArray(o) ? o.filter((c) => c && typeof c.n === "number" && typeof c.path === "string" && isObj(c.data)) : [];
    } catch (e) {
      return [];
    }
  };
  const keepOutbox = () => {
    if (!me) return false;
    const key = OUTBOX + me.id;
    // Another window of the app on this phone may have written down changes of its own: they stay too.
    const mine = new Set(outbox.map((c) => c.n));
    for (const c of readOutbox(me.id)) if (!mine.has(c.n) && !gone.has(c.n)) outbox.push({ ...c, kept: true });
    outbox.sort((a, b) => a.n - b.n);
    const write = () => (outbox.length ? localStorage.setItem(key, JSON.stringify(outbox)) : localStorage.removeItem(key));
    try {
      write();
      return true;
    } catch (e) {
      // No room left for this site on the phone: the copy of the records goes (it comes back from the website), the changes stay.
      forget("");
      try {
        write();
        return true;
      } catch (x) {
        return false;
      }
    }
  };

  /* ---------- talking to the website ---------- */
  const signedOut = () => {
    forget("");
    // In the app's frame: the whole app goes to its sign-in (the unsent changes stay on the phone for this login).
    try {
      (window.parent !== window ? window.parent : window).location.href = "/todo";
    } catch (e) {
      window.location.href = "/todo";
    }
  };
  // A request the website doesn't answer within the time counts as no signal (a weak signal can hang for minutes).
  const timed = (url, init, ms) => {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), ms) : null;
    return fetch(url, { ...(init || {}), signal: ctl ? ctl.signal : undefined }).finally(() => clearTimeout(t));
  };
  const getJson = async (url) => {
    const r = await timed(url, { cache: "no-store" }, 15000);
    if (r.status === 401) {
      signedOut();
      throw Object.assign(new Error("signed out"), { gone: true });
    }
    // A login that doesn't open the roll call: back to the app's home page.
    if (r.status === 403) {
      forget("");
      window.location.href = "/todo";
      throw Object.assign(new Error("not this login's"), { gone: true });
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  const fail = (r, body) => ({
    code: r.status === 403 ? "not_granted" : r.status === 404 ? "not_found" : r.status >= 500 ? "unavailable" : "failed_precondition",
    message: (body && body.error) || "That didn't save (" + r.status + ").",
  });

  const useCopy = (c) => {
    me = c.me;
    window.__rcMe = me;
    window.__rcCdn = c.cdn;
    window.__rcLocations = c.locations || [];
    window.__rcLinks = c.links || [];
    outbox = readOutbox(me.id).map((x) => ({ ...x, kept: true }));
    apply(c.docs);
    cursor = c.cursor || cursor;
    try {
      seenAt = localStorage.getItem(SEEN);
    } catch (e) {}
  };
  const useLogin = (who) => {
    me = who.me;
    window.__rcMe = me;
    window.__rcCdn = who.cdn;
    // Where Payday can put the week's wages in QuickBooks.
    window.__rcLocations = who.locations || [];
    // A laptop's rail: the app's other parts this login opens.
    window.__rcLinks = who.links || [];
    forget(keyFor(me));
  };

  async function start() {
    // The copy on this phone opens straight away; the website is asked meanwhile (with no signal, it just carries on).
    const copy = lastCopy();
    if (copy) {
      useCopy(copy);
      settle.resolve();
      tell();
      confirm();
      return;
    }
    // The first time on this phone: the website first.
    try {
      const who = await getJson("/api/rollcall?me=1");
      // Not moved in yet: the page shows the note instead of an empty register.
      if (who.note) {
        window.__rcNote = who.note;
        return settle.reject(new Error("not moved in yet"));
      }
      useLogin(who);
      outbox = readOutbox(me.id).map((x) => ({ ...x, kept: true }));
      apply((await getJson("/api/rollcall")).docs);
      confirmed = true;
      heard();
      saveCopy();
      settle.resolve();
      tell();
      send();
      schedule();
    } catch (e) {
      settle.reject(e);
    }
  }

  // Who is signed in now (the copy may be from before a sign-out, or another login on this phone), then what waits.
  let confirmT;
  async function confirm() {
    clearTimeout(confirmT);
    if (confirmed) return;
    try {
      const who = await getJson("/api/rollcall?me=1");
      if (who.note) return;
      const was = me;
      if (who.me.id !== was.id || (who.me.sections || []).join(",") !== (was.sections || []).join(",")) {
        // Someone else on this phone, or this login's parts changed: the register starts again from the website.
        forget("");
        window.location.reload();
        return;
      }
      useLogin(who);
      if (typeof window.appLinks === "function") window.appLinks(window.__rcLinks);
      confirmed = true;
      signal(true);
      saveCopy();
      await send();
      poll();
    } catch (e) {
      if (e && e.gone) return;
      signal(false);
      confirmT = setTimeout(confirm, 8000);
    }
  }

  // Every 5 seconds while someone is using it, every 30 when it just sits open (or the app shows another part:
  // window.__rcActive, 2 Nov 2026), at once when it comes back.
  let timer;
  let lastUse = Date.now();
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(poll, window.__rcActive !== false && Date.now() - lastUse < 180000 ? 5000 : 30000);
  };
  async function poll() {
    if (document.visibilityState === "visible" && me && confirmed) {
      // What was changed with no signal goes first (the news then includes it).
      if (outbox.length) await send();
      try {
        const res = await getJson("/api/rollcall" + (cursor ? "?since=" + encodeURIComponent(cursor) : ""));
        signal(true);
        const cols = apply(res.docs);
        if (cols.size) {
          notify(cols);
          saveCopy();
        }
      } catch (e) {
        if (!(e && e.gone)) signal(false);
      }
    }
    schedule();
  }
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    lastUse = Date.now();
    if (!confirmed) return void confirm();
    clearTimeout(timer);
    poll();
  };
  // A record the website changed itself (a MoMo name check, 21 Nov 2026): shown at once, not at the next poll.
  window.__rcTake = (doc) => {
    if (!doc) return;
    const cols = apply([doc]);
    if (cols.size) {
      notify(cols);
      saveCopy();
    }
  };
  document.addEventListener("pointerdown", () => (lastUse = Date.now()), { capture: true, passive: true });
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);

  /* ---------- saving: on the phone first, then to the website in order ---------- */
  let seq = 0;
  function write(path, op, data) {
    if (!me) return Promise.reject({ code: "unavailable", message: "No signal" });
    const change = { n: Date.now() * 1000 + (++seq % 1000), path, op, data: clone(data), at: new Date().toISOString(), tries: 0, kept: false };
    outbox.push(change);
    if (!keepOutbox()) {
      outbox = outbox.filter((c) => c.n !== change.n);
      return Promise.reject({ code: "unavailable", message: "There's no room on this phone to keep it" });
    }
    notify(new Set([colOf(path)]));
    tell();
    return new Promise((resolve, reject) => {
      waiting.set(change.n, { resolve, reject });
      // No signal: done for the page at once (it's on the phone and goes by itself). A slow one: after a moment.
      if (!confirmed || noSignal) done(change.n);
      else setTimeout(() => done(change.n), 2500);
      send();
    });
  }
  const done = (n, error) => {
    const w = waiting.get(n);
    if (!w) return false;
    waiting.delete(n);
    if (error) w.reject(error);
    else w.resolve();
    return true;
  };
  const doneAll = () => {
    for (const n of [...waiting.keys()]) done(n);
  };

  let sending = null;
  let retryT;
  let gap = 0;
  const retryLater = () => {
    clearTimeout(retryT);
    gap = Math.min(30000, gap ? gap * 2 : 3000);
    retryT = setTimeout(() => send(), gap);
  };
  function send() {
    if (!sending) sending = sendAll().finally(() => (sending = null));
    return sending;
  }
  async function sendAll() {
    if (!me || !confirmed) return;
    let late = 0;
    while (outbox.length) {
      const change = outbox[0];
      let r;
      try {
        const body = JSON.stringify({ path: change.path, op: change.op, data: change.data });
        r = await timed("/api/rollcall", { method: "POST", headers: { "Content-Type": "application/json" }, body }, 20000);
      } catch (e) {
        // No signal (or no answer in time): it stays on the phone and goes again shortly.
        for (const c of outbox) c.kept = true;
        keepOutbox();
        signal(false);
        doneAll();
        return retryLater();
      }
      if (r.status === 401) {
        doneAll();
        return signedOut();
      }
      const body = await r.json().catch(() => ({}));
      if ((r.status >= 500 || r.status === 408 || r.status === 429) && (change.tries || 0) < 7) {
        // The website had a problem: tried again shortly; a change it keeps refusing is let go after a while.
        change.tries = (change.tries || 0) + 1;
        change.kept = true;
        keepOutbox();
        doneAll();
        return retryLater();
      }
      gone.add(change.n);
      outbox = outbox.filter((c) => c.n !== change.n);
      keepOutbox();
      gap = 0;
      if (!r.ok) {
        // Refused (this login can't change that, or the record is gone): the screen goes back to what the website has.
        notify(new Set([colOf(change.path)]));
        const error = fail(r, body);
        if (!done(change.n, error)) say("A change made with no signal wasn't saved: " + error.message);
        continue;
      }
      signal(true);
      const cols = apply([body.doc]);
      cols.add(colOf(change.path));
      notify(cols);
      saveCopy();
      done(change.n);
      if (change.kept) late++;
    }
    tell();
    if (late && typeof window.toast === "function") window.toast("Saved: everything marked with no signal is in now");
  }

  /* ---------- how it stands, for the person holding the phone ---------- */
  let bar;
  let notice = "";
  let told = "";
  const hm = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
  };
  function signal(ok) {
    if (ok) {
      misses = 0;
      heard();
      noSignal = false;
    } else {
      misses++;
      // One missed look isn't "no signal" yet (a weak signal drops one now and then).
      if (misses >= 2 || !confirmed || outbox.length) noSignal = true;
    }
    tell();
  }
  const say = (text) => {
    notice = text;
    tell();
  };
  function tell() {
    const n = outbox.length;
    let text = "";
    if (notice) text = notice;
    else if (n && (noSignal || !confirmed)) text = "No signal. What you mark is kept on this phone and saves by itself when the signal is back.";
    else if (n) text = "Saving what was marked with no signal…";
    else if (noSignal) text = "No signal: the register as it was" + (seenAt ? " at " + hm(seenAt) : "") + ". What you mark is kept on this phone.";
    try {
      if (!bar && document.body) {
        const st = document.createElement("style");
        st.textContent = "#rc-sync{position:sticky;top:0;z-index:8;padding-top:8px;padding-bottom:4px;background:var(--bg)}#rc-sync .ro{margin:0}#rc-sync button{margin-left:8px}";
        document.head.appendChild(st);
        bar = document.createElement("div");
        bar.id = "rc-sync";
        bar.className = "wrap";
        bar.hidden = true;
        bar.innerHTML = '<div class="ro warn" role="status"><span></span><button type="button" class="linkbtn" hidden>OK</button></div>';
        bar.querySelector("button").addEventListener("click", () => say(""));
        const app = document.getElementById("app");
        if (app) app.before(bar);
        else document.body.prepend(bar);
      }
      if (bar) {
        bar.hidden = !text;
        bar.querySelector("span").textContent = text;
        bar.querySelector("button").hidden = !notice;
      }
    } catch (e) {}
    // The app around the page says it too, on its other parts.
    const now = n + ":" + (noSignal || !confirmed);
    if (now === told) return;
    told = now;
    try {
      if (window.parent !== window) window.parent.postMessage({ type: "rc-waiting", n, noSignal: noSignal || !confirmed }, location.origin);
    } catch (e) {}
  }

  const newId = () => {
    const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => abc[b % 36]).join("");
  };
  const add = (map, key, cb) => (map.get(key) || map.set(key, []).get(key)).push(cb);
  const drop = (map, key, cb) => map.set(key, (map.get(key) || []).filter((x) => x !== cb));

  const db = {
    doc(path) {
      return {
        id: path.split("/").pop(),
        get: async () => snapDoc(path),
        set: (data) => write(path, "set", data),
        update: (data) => write(path, "update", data),
        onSnapshot(cb) {
          add(docSubs, path, cb);
          setTimeout(() => cb(snapDoc(path)), 0);
          return () => drop(docSubs, path, cb);
        },
      };
    },
    collection(col) {
      return {
        doc: (id) => db.doc(col + "/" + (id || newId())),
        onSnapshot(cb) {
          add(colSubs, col, cb);
          setTimeout(() => cb(snapCol(col)), 0);
          return () => drop(colSubs, col, cb);
        },
      };
    },
  };

  const assets = {
    async upload(blob) {
      const form = new FormData();
      form.append("file", blob, "photo.jpg");
      let r;
      try {
        r = await fetch("/api/rollcall/photo", { method: "POST", body: form });
      } catch (e) {
        throw { code: "unavailable", message: "No signal" };
      }
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw { code: r.status === 413 ? "too_large" : r.status === 415 ? "unsupported_type" : "failed", message: body.error };
      return { id: body.id };
    },
    async delete(id) {
      await fetch("/api/rollcall/photo?id=" + encodeURIComponent(id), { method: "DELETE" }).catch(() => {});
    },
  };

  // Excel backups and the bank's .xls file: the phone saves (or opens) the file. `type` defaults to .xlsx.
  const downloads = {
    async save({ filename, data, type }) {
      const url = URL.createObjectURL(new Blob([data], { type: type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    },
  };

  const user = { can: async () => true };
  window.claude = {
    use: async (name) => {
      await ready;
      return name === "db" ? db : name === "assets" ? assets : name === "downloads" ? downloads : name === "user" ? user : null;
    },
  };
  start();
})();
