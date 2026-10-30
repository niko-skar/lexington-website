// Site roll call inside the Lexington app (30 Oct 2026). The roll call page was made as a Claude page and
// asks for a database, a photo store and a downloads helper (window.claude.use). Here the website answers the
// same calls: /api/rollcall (what this login may see and save) and /api/rollcall/photo. A copy is kept on the
// phone, so the page opens at once and still shows the register with a weak signal; each change since is
// fetched every few seconds while it's open.
(() => {
  window.__rcShim = true;
  const CACHE = "rollcall-v1:";
  const store = new Map(); // "days/2026-11-02" -> { data, rev }
  const colSubs = new Map();
  const docSubs = new Map();
  let cursor = "";
  let me = null;
  let settle;
  const ready = new Promise((resolve, reject) => (settle = { resolve, reject }));

  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const colOf = (path) => path.split("/")[0];
  const snapDoc = (path) => {
    const d = store.get(path);
    return { id: path.split("/").pop(), exists: !!d, data: () => clone(d && d.data), metadata: { hasPendingWrites: false } };
  };
  const snapCol = (col) => {
    const docs = [...store.keys()].filter((k) => colOf(k) === col).sort().map(snapDoc);
    return { docs, size: docs.length, empty: !docs.length, metadata: { hasPendingWrites: false }, docChanges: () => [] };
  };
  const notify = (cols) => {
    for (const col of cols) for (const cb of colSubs.get(col) || []) cb(snapCol(col));
    for (const [path, cbs] of docSubs) if (cols.has(colOf(path))) for (const cb of cbs) cb(snapDoc(path));
  };
  // Records from the website: newer versions replace the copy; the same version again (asked from the same second) is skipped.
  const apply = (docs) => {
    const cols = new Set();
    for (const d of docs || []) {
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
  const forget = (except) => {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE) && k !== except) localStorage.removeItem(k);
      }
    } catch (e) {}
  };
  let saveT;
  const saveCopy = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!me) return;
      try {
        const docs = [...store].map(([p, d]) => ({ col: colOf(p), key: p.slice(p.indexOf("/") + 1), rev: d.rev, data: d.data }));
        localStorage.setItem(keyFor(me), JSON.stringify({ v: 1, me, cdn: window.__rcCdn, cursor, docs }));
        localStorage.setItem(CACHE + "last", keyFor(me));
      } catch (e) {}
    }, 800);
  };
  const readCopy = (key) => {
    try {
      const c = JSON.parse(localStorage.getItem(key) || "null");
      return c && c.v === 1 ? c : null;
    } catch (e) {
      return null;
    }
  };

  /* ---------- talking to the website ---------- */
  const signedOut = () => {
    forget("");
    window.location.href = "/todo";
  };
  const getJson = async (url) => {
    const r = await fetch(url, { cache: "no-store" });
    if (r.status === 401) {
      signedOut();
      throw new Error("signed out");
    }
    // A login that doesn't open the roll call: back to the app's home page.
    if (r.status === 403) {
      forget("");
      window.location.href = "/todo";
      throw new Error("not this login's");
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  const fail = (r, body) => ({
    code: r.status === 403 ? "not_granted" : r.status === 404 ? "not_found" : r.status >= 500 ? "unavailable" : "failed_precondition",
    message: (body && body.error) || "That didn't save (" + r.status + ").",
  });

  async function start() {
    let first = null;
    try {
      const who = await getJson("/api/rollcall?me=1");
      // Not moved in yet: the page shows the note instead of an empty register.
      if (who.note) {
        window.__rcNote = who.note;
        return settle.reject(new Error("not moved in yet"));
      }
      me = who.me;
      window.__rcMe = me;
      window.__rcCdn = who.cdn;
      forget(keyFor(me));
      first = readCopy(keyFor(me));
    } catch (e) {
      // No signal: open on the last copy this phone kept, if there is one.
      const last = (() => {
        try {
          return localStorage.getItem(CACHE + "last");
        } catch (x) {
          return null;
        }
      })();
      first = last ? readCopy(last) : null;
      if (!first) return settle.reject(e);
      me = first.me;
      window.__rcMe = me;
      window.__rcCdn = first.cdn;
    }
    if (first) {
      apply(first.docs);
      cursor = first.cursor || cursor;
      settle.resolve();
      poll();
      return;
    }
    try {
      apply((await getJson("/api/rollcall")).docs);
      saveCopy();
      settle.resolve();
      schedule();
    } catch (e) {
      settle.reject(e);
    }
  }

  // Every 5 seconds while someone is using it, every 30 when it just sits open, at once when it comes back.
  let timer;
  let lastUse = Date.now();
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(poll, Date.now() - lastUse < 180000 ? 5000 : 30000);
  };
  async function poll() {
    if (document.visibilityState === "visible" && me) {
      try {
        const res = await getJson("/api/rollcall" + (cursor ? "?since=" + encodeURIComponent(cursor) : ""));
        const cols = apply(res.docs);
        if (cols.size) {
          notify(cols);
          saveCopy();
        }
      } catch (e) {}
    }
    schedule();
  }
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    lastUse = Date.now();
    clearTimeout(timer);
    poll();
  };
  document.addEventListener("pointerdown", () => (lastUse = Date.now()), { capture: true, passive: true });
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);

  async function write(path, op, data) {
    let r;
    try {
      r = await fetch("/api/rollcall", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, op, data }) });
    } catch (e) {
      throw { code: "unavailable", message: "No signal" };
    }
    if (r.status === 401) {
      signedOut();
      throw { code: "unauthenticated", message: "Signed out" };
    }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(r, body);
    const cols = apply([body.doc]);
    if (cols.size) {
      notify(cols);
      saveCopy();
    }
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

  // Excel backups: the phone saves (or opens) the file.
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
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
