"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { todoSignOutAction } from "@/lib/actions/todo";
import { AREAS, areaLabel, MAX_NOTE, MAX_TEXT, photoAt, type TodoMe, type TodoTask } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { forgetPhoto, uploadPhoto } from "./photo";
import styles from "./Todo.module.css";

type Tab = "open" | "done";
/** A message at the bottom; after a tick it offers "Add photo of the fix" and "Undo" for that job. */
type ToastData = { text: string; tone?: "error"; jobId?: string };
type InstallPrompt = Event & { prompt: () => Promise<void> };

// The hidden photo pickers. Buttons that take a photo are <label>s for these: tapping a label
// opens its picker the same way on an iPhone and an Android.
const NEW_CAMERA = "todo-new-camera";
const NEW_GALLERY = "todo-new-gallery";
const FIX_CAMERA = "todo-fix-camera";

/* ---------- small helpers ---------- */

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function ago(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return days < 14 ? `${days} day${days === 1 ? "" : "s"} ago` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function dayName(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

async function send(url: string, method: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error("No signal: that didn't save. Try again when you have data."), { status: 0 });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "That didn't save. Try again."), { status: response.status });
  return data;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "That didn't save. Try again.");

// Facts about the phone that never change while the page is open (read without an effect).
const never = () => () => {};
function useStandalone() {
  return useSyncExternalStore(
    never,
    () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => true
  );
}
function useIphone() {
  return useSyncExternalStore(never, () => /iphone|ipad|ipod/i.test(navigator.userAgent), () => false);
}
function useHintClosedBefore() {
  return useSyncExternalStore(
    never,
    () => {
      try {
        return localStorage.getItem("todo-hint-closed") === "1";
      } catch {
        return false;
      }
    },
    () => true
  );
}

/* ---------- photo slot (used by the new-job and fix-photo sheets) ---------- */

type Slot = { preview: string; state: "uploading" | "ready" | "error"; id?: string; url?: string; error?: string };

function useUploadSlot() {
  const [slot, setSlot] = useState<Slot | null>(null);
  const job = useRef<Promise<{ id: string; url: string } | null> | null>(null);
  const token = useRef(0);

  const start = useCallback((file: File) => {
    const mine = ++token.current;
    const preview = URL.createObjectURL(file);
    setSlot((old) => {
      if (old?.preview) URL.revokeObjectURL(old.preview);
      if (old?.id) forgetPhoto(old.id);
      return { preview, state: "uploading" };
    });
    job.current = uploadPhoto(file).then(
      (stored) => {
        if (token.current !== mine) {
          forgetPhoto(stored.id); // replaced by a newer photo meanwhile
          return null;
        }
        setSlot({ preview, state: "ready", id: stored.id, url: stored.url });
        return stored;
      },
      (e) => {
        if (token.current === mine) setSlot({ preview, state: "error", error: errorText(e) });
        return null;
      }
    );
  }, []);

  const clear = useCallback((keepStored = false) => {
    token.current++;
    job.current = null;
    setSlot((old) => {
      if (old?.preview) URL.revokeObjectURL(old.preview);
      if (old?.id && !keepStored) forgetPhoto(old.id);
      return null;
    });
  }, []);

  /** Waits for an upload still on its way; null when there's no photo or it failed. */
  const settled = useCallback(async () => (job.current ? job.current : null), []);

  return { slot, start, clear, settled };
}

/* ---------- the app ---------- */

export function TodoApp({ me, initialTasks, startedOffline }: { me: TodoMe; initialTasks: TodoTask[]; startedOffline: boolean }) {
  const isAdmin = me.kind === "admin";
  const [tasks, setTasks] = useState<TodoTask[]>(initialTasks);
  const tasksRef = useRef<TodoTask[]>(initialTasks);
  const [tab, setTab] = useState<Tab>("open");
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [composer, setComposer] = useState<null | { mode: "new"; file?: File } | { mode: "edit"; task: TodoTask }>(null);
  const [proof, setProof] = useState<null | { task: TodoTask; file?: File; noteOnly?: boolean }>(null);
  const [fixTarget, setFixTarget] = useState<string | null>(null);
  const [itemMenu, setItemMenu] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const standalone = useStandalone();
  const isIphone = useIphone();
  const hintClosedBefore = useHintClosedBefore();
  const [hintClosedNow, setHintClosedNow] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Changes made on this phone that the server hasn't confirmed yet are laid over every refresh,
  // and once confirmed they beat any refresh that left the server before they did. That way
  // both phones can tap away at the same time without anything jumping back.
  const pending = useRef(new Map<string, Partial<TodoTask>>());
  const wins = useRef(new Map<string, number>());
  const gone = useRef(new Set<string>());
  const seq = useRef(new Map<string, number>());
  const chains = useRef(new Map<string, Promise<unknown>>());
  const inFlight = useRef(false);
  const lastActive = useRef(0);

  const commit = useCallback((next: TodoTask[]) => {
    tasksRef.current = next;
    setTasks(next);
  }, []);

  const showToast = useCallback((data: ToastData) => {
    clearTimeout(toastTimer.current);
    setToast(data);
    toastTimer.current = setTimeout(() => setToast(null), data.jobId ? 7000 : 3500);
  }, []);

  const applyServer = useCallback(
    (list: TodoTask[], startedAt: number) => {
      const local = new Map(tasksRef.current.map((t) => [t.id, t]));
      const seen = new Set<string>();
      const out: TodoTask[] = [];
      for (const t of list) {
        seen.add(t.id);
        if (gone.current.has(t.id)) continue;
        const won = (wins.current.get(t.id) ?? 0) > startedAt;
        let item = (won && local.get(t.id)) || t;
        const overlay = pending.current.get(t.id);
        if (overlay) item = { ...item, ...overlay };
        out.push(item);
      }
      // Jobs this phone just added that the server didn't have yet when it answered.
      for (const t of tasksRef.current) {
        if (!seen.has(t.id) && !gone.current.has(t.id) && (wins.current.get(t.id) ?? 0) > startedAt) out.push(t);
      }
      commit(out);
    },
    [commit]
  );

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/todo", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error("refresh failed");
      const data = (await response.json()) as { tasks: TodoTask[] };
      applyServer(data.tasks, startedAt);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, [applyServer]);

  // Live: every 5 seconds while someone is using it, every 20 when it just sits open,
  // straight away when the app comes back to the front or the signal returns.
  useEffect(() => {
    lastActive.current = Date.now();
    const active = () => {
      lastActive.current = Date.now();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") await refresh();
      if (stopped) return;
      const busy = Date.now() - lastActive.current < 180_000;
      clearTimeout(timer);
      timer = setTimeout(loop, document.visibilityState === "visible" && busy ? 5_000 : 20_000);
    };
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      lastActive.current = Date.now();
      clearTimeout(timer);
      void loop();
    };
    timer = setTimeout(loop, 5_000);
    window.addEventListener("pointerdown", active, { passive: true });
    window.addEventListener("keydown", active);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [refresh]);

  // Home-screen app: the helper that lets Android install it, and Android's own install offer.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    navigator.serviceWorker?.register("/todo-sw.js", { scope: "/todo" }).catch(() => {});
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const closeHint = () => {
    setHintClosedNow(true);
    try {
      localStorage.setItem("todo-hint-closed", "1");
    } catch {
      /* private mode: the tip just comes back next time */
    }
  };

  /* ---------- changes ---------- */

  const mutate = useCallback(
    async (id: string, optimistic: Partial<TodoTask>, body: Record<string, unknown>) => {
      const n = (seq.current.get(id) ?? 0) + 1;
      seq.current.set(id, n);
      pending.current.set(id, { ...(pending.current.get(id) ?? {}), ...optimistic });
      commit(tasksRef.current.map((t) => (t.id === id ? { ...t, ...optimistic } : t)));
      // One change at a time per job, in the order they were tapped.
      const job = (chains.current.get(id) ?? Promise.resolve()).then(() => send(`/api/todo/${id}`, "PATCH", body));
      chains.current.set(
        id,
        job.then(
          () => undefined,
          () => undefined
        )
      );
      try {
        const { task } = (await job) as { task: TodoTask };
        if (seq.current.get(id) === n) {
          pending.current.delete(id);
          wins.current.set(id, Date.now());
          commit(tasksRef.current.map((t) => (t.id === id ? task : t)));
        }
        return task;
      } catch (e) {
        if (seq.current.get(id) === n) {
          pending.current.delete(id);
          wins.current.delete(id);
        }
        if ((e as { status?: number }).status === 401) setSignedOut(true);
        showToast({ text: errorText(e), tone: "error" });
        void refresh();
        return null;
      }
    },
    [commit, refresh, showToast]
  );

  const reopen = useCallback(
    (id: string) => {
      void mutate(id, { status: "open", doneAt: null, doneBy: null, doneNote: null, fixUrl: null }, { action: "reopen" });
    },
    [mutate]
  );

  const tick = useCallback(
    (id: string) => {
      setItemMenu(null);
      void mutate(id, { status: "done", doneAt: new Date().toISOString(), doneBy: me.name }, { action: "done" });
      showToast({ text: "Ticked off", jobId: id });
    },
    [mutate, me.name, showToast]
  );

  const remove = useCallback(
    async (id: string) => {
      setArmed(null);
      setItemMenu(null);
      gone.current.add(id);
      commit(tasksRef.current.filter((t) => t.id !== id));
      try {
        await send(`/api/todo/${id}`, "DELETE");
        showToast({ text: "Deleted from the list" });
      } catch (e) {
        gone.current.delete(id);
        showToast({ text: errorText(e), tone: "error" });
        void refresh();
      }
    },
    [commit, refresh, showToast]
  );

  const added = useCallback(
    (task: TodoTask) => {
      wins.current.set(task.id, Date.now());
      commit([task, ...tasksRef.current.filter((t) => t.id !== task.id)]);
      setTab("open");
      showToast({ text: "Added to the list" });
    },
    [commit, showToast]
  );

  /* ---------- what to show ---------- */

  const open = useMemo(() => tasks.filter((t) => t.status !== "done"), [tasks]);
  const done = useMemo(
    () => tasks.filter((t) => t.status === "done").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")),
    [tasks]
  );
  const doneToday = done.filter((t) => t.doneAt && new Date(t.doneAt).toDateString() === new Date().toDateString()).length;

  // To do: floor by floor (walk the building), urgent first, then the longest waiting.
  const openGroups = useMemo(() => {
    const known = AREAS as readonly string[];
    return ([...AREAS, null] as (string | null)[])
      .map((area) => ({
        area,
        items: open
          .filter((t) => (area === null ? !known.includes(t.area ?? "") : t.area === area))
          .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.createdAt.localeCompare(b.createdAt)),
      }))
      .filter((g) => g.items.length > 0);
  }, [open]);

  const doneGroups = useMemo(() => {
    const groups: { day: string; items: TodoTask[] }[] = [];
    for (const t of done) {
      const day = t.doneAt ? dayName(t.doneAt) : "Earlier";
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(t);
      else groups.push({ day, items: [t] });
    }
    return groups;
  }, [done]);

  /* ---------- render ---------- */

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>, then: (file: File) => void) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) then(file);
  };

  return (
    <div className={styles.app}>
      <header className={styles.top}>
        <div className={styles.topRow}>
          <div>
            <h1 className={styles.title}>Site to-do</h1>
            <p className={styles.counts}>
              {open.length} to do · {doneToday} done today
            </p>
          </div>
          <button type="button" className={styles.menuButton} onClick={() => setMenuOpen(true)} aria-label="Menu">
            <span aria-hidden="true">☰</span>
          </button>
        </div>
        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === "open"} className={tab === "open" ? styles.tabOn : styles.tab} onClick={() => setTab("open")}>
            To do <span className={styles.tabCount}>{open.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "done"} className={tab === "done" ? styles.tabOn : styles.tab} onClick={() => setTab("done")}>
            Done <span className={styles.tabCount}>{done.length}</span>
          </button>
        </div>
      </header>

      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the list as it was. It updates by itself when the signal is back.
        </div>
      )}

      {!standalone && !hintClosedBefore && !hintClosedNow && (
        <div className={styles.hint}>
          {installPrompt ? (
            <>
              <span>Put the list on your home screen so it opens like an app.</span>
              <button
                type="button"
                className={styles.hintButton}
                onClick={async () => {
                  await installPrompt.prompt().catch(() => {});
                  setInstallPrompt(null);
                }}
              >
                Install the app
              </button>
            </>
          ) : isIphone ? (
            <span>
              Put it on your home screen: tap <b>Share</b> <span aria-hidden="true">⬆︎</span>, then <b>Add to Home Screen</b>. It then opens like an app.
            </span>
          ) : (
            <span>
              Put it on your home screen: in Chrome tap <b>⋮</b>, then <b>Add to Home screen</b> (or <b>Install app</b>).
            </span>
          )}
          <button type="button" className={styles.hintClose} onClick={closeHint} aria-label="Close the tip">
            ✕
          </button>
        </div>
      )}

      <main className={styles.main}>
        {isAdmin && tab === "open" && (
          <div className={styles.addBar}>
            <label htmlFor={NEW_CAMERA} className={styles.addPhoto} role="button" tabIndex={0}>
              <span aria-hidden="true">📷</span> Take photo
            </label>
            <button type="button" className={styles.addWrite} onClick={() => setComposer({ mode: "new" })}>
              Write one
            </button>
          </div>
        )}

        {tab === "open" &&
          (openGroups.length === 0 ? (
            <p className={styles.empty}>
              {isAdmin
                ? "Nothing to do. Take a photo of something on site and say what needs doing, and it appears here."
                : "Nothing to do right now. New jobs appear here by themselves."}
            </p>
          ) : (
            openGroups.map((group) => (
              <section key={group.area ?? "none"} className={styles.group}>
                <h2 className={styles.groupTitle}>
                  {areaLabel(group.area)} <span>{group.items.length}</span>
                </h2>
                {group.items.map((task) => (
                  <article key={task.id} className={`${styles.card} ${task.urgent ? styles.cardUrgent : ""}`}>
                    {task.photoUrl && (
                      <button type="button" className={styles.photo} onClick={() => setLightbox(task.photoUrl)} aria-label="Open the photo">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
                        <img src={photoAt(task.photoUrl, 900)} alt="" loading="lazy" />
                      </button>
                    )}
                    <div className={styles.cardBody}>
                      {task.urgent && <span className={styles.urgent}>Urgent</span>}
                      {task.text ? <p className={styles.text}>{task.text}</p> : <p className={styles.textMuted}>No note, see the photo.</p>}
                      <p className={styles.meta}>
                        Added {ago(task.createdAt)}
                        {task.createdBy ? ` by ${task.createdBy}` : ""}
                      </p>
                    </div>
                    <div className={styles.cardActions}>
                      {/* eslint-disable-next-line react-hooks/refs -- the tick reads its bookkeeping when tapped, never while drawing */}
                      <button type="button" className={styles.doneButton} onClick={() => tick(task.id)}>
                        <span aria-hidden="true">✓</span> Done
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          className={styles.moreButton}
                          aria-label="More"
                          aria-expanded={itemMenu === task.id}
                          onClick={() => {
                            setArmed(null);
                            setItemMenu(itemMenu === task.id ? null : task.id);
                          }}
                        >
                          ⋯
                        </button>
                      )}
                    </div>
                    {isAdmin && itemMenu === task.id && (
                      <div className={styles.itemMenu}>
                        <button
                          type="button"
                          onClick={() => {
                            setItemMenu(null);
                            setComposer({ mode: "edit", task });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={armed === task.id ? styles.dangerArmed : styles.danger}
                          onClick={() => (armed === task.id ? void remove(task.id) : setArmed(task.id))}
                        >
                          {armed === task.id ? "Tap again to delete" : "Delete"}
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </section>
            ))
          ))}

        {tab === "done" &&
          (doneGroups.length === 0 ? (
            <p className={styles.empty}>Ticked-off jobs show here, newest first.</p>
          ) : (
            doneGroups.map((group) => (
              <section key={group.day} className={styles.group}>
                <h2 className={styles.groupTitle}>
                  {group.day} <span>{group.items.length}</span>
                </h2>
                {group.items.map((task) => (
                  <article key={task.id} className={`${styles.card} ${styles.doneCard}`}>
                    <div className={styles.doneRow}>
                      {task.photoUrl ? (
                        <button type="button" className={styles.thumb} onClick={() => setLightbox(task.photoUrl)} aria-label="Open the photo">
                          {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
                          <img src={photoAt(task.photoUrl, 240)} alt="" loading="lazy" />
                        </button>
                      ) : (
                        <span className={styles.thumbEmpty} aria-hidden="true">
                          ✓
                        </span>
                      )}
                      <div className={styles.doneText}>
                        <p className={styles.text}>{task.text || "No note"}</p>
                        <p className={styles.doneMeta}>
                          ✓ Done{task.doneBy ? ` by ${task.doneBy}` : ""}
                          {task.doneAt ? ` · ${when(task.doneAt)}` : ""} · {areaLabel(task.area)}
                        </p>
                        {task.doneNote && <p className={styles.doneNote}>&ldquo;{task.doneNote}&rdquo;</p>}
                      </div>
                    </div>
                    {task.fixUrl && (
                      <button type="button" className={styles.fixPhoto} onClick={() => setLightbox(task.fixUrl)} aria-label="Open the photo of the fix">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
                        <img src={photoAt(task.fixUrl, 900)} alt="" loading="lazy" />
                        <span>Photo of the fix</span>
                      </button>
                    )}
                    <div className={styles.doneActions}>
                      {!task.fixUrl && (
                        <label htmlFor={FIX_CAMERA} role="button" tabIndex={0} onClick={() => setFixTarget(task.id)}>
                          Add photo of the fix
                        </label>
                      )}
                      <button type="button" onClick={() => setProof({ task, noteOnly: true })}>
                        {task.doneNote ? "Change note" : "Add note"}
                      </button>
                      {/* eslint-disable-next-line react-hooks/refs -- runs when tapped, never while drawing */}
                      <button type="button" onClick={() => reopen(task.id)}>
                        Not done
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          className={armed === task.id ? styles.dangerArmed : styles.danger}
                          onClick={() => (armed === task.id ? void remove(task.id) : setArmed(task.id))}
                        >
                          {armed === task.id ? "Tap again to delete" : "Delete"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </section>
            ))
          ))}
      </main>

      {/* The photo pickers. "capture" opens the camera straight away on phones. New jobs are
          the office's, so only the office gets those two. */}
      {isAdmin && (
        <>
          <input
            id={NEW_CAMERA}
            data-picker="new"
            className={styles.hiddenInput}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => pickFile(e, (file) => setComposer({ mode: "new", file }))}
          />
          <input
            id={NEW_GALLERY}
            data-picker="gallery"
            className={styles.hiddenInput}
            type="file"
            accept="image/*"
            onChange={(e) => pickFile(e, (file) => setComposer({ mode: "new", file }))}
          />
        </>
      )}
      <input
        id={FIX_CAMERA}
        data-picker="fix"
        className={styles.hiddenInput}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) =>
          pickFile(e, (file) => {
            const task = tasks.find((t) => t.id === fixTarget);
            if (task) setProof({ task, file });
          })
        }
      />

      {composer && (
        <Composer
          key={composer.mode === "edit" ? composer.task.id : "new"}
          initial={composer}
          onClose={() => setComposer(null)}
          onAdded={(task) => {
            setComposer(null);
            added(task);
          }}
          onEdit={(task, change) => {
            setComposer(null);
            void mutate(task.id, change, { action: "edit", ...change });
          }}
        />
      )}

      {proof && (
        <ProofSheet
          task={proof.task}
          file={proof.file}
          noteOnly={proof.noteOnly}
          onClose={() => setProof(null)}
          onSave={async (note, photo) => {
            const optimistic: Partial<TodoTask> = { doneNote: note || null, ...(photo ? { fixUrl: photo.url } : {}) };
            const body: Record<string, unknown> = { action: "proof", note, ...(photo ? { photoId: photo.id } : {}) };
            setProof(null);
            const saved = await mutate(proof.task.id, optimistic, body);
            if (saved) showToast({ text: photo ? "Photo of the fix saved" : "Note saved" });
          }}
        />
      )}

      {menuOpen && (
        <div className={styles.sheetBackdrop} onClick={() => setMenuOpen(false)}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Menu">
            <p className={styles.sheetNote}>
              Signed in as <b>{me.name}</b>
              {isAdmin ? " (office)" : ""}
            </p>
            <div className={styles.menuList}>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setAccessOpen(true);
                  }}
                >
                  Foreman logins
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void refresh();
                }}
              >
                Refresh now
              </button>
              {isAdmin && <Link href="/admin/crm">Back to the admin pages</Link>}
              <form action={todoSignOutAction}>
                <button type="submit">Sign out</button>
              </form>
            </div>
            <button type="button" className={styles.sheetCancel} onClick={() => setMenuOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)} role="dialog" aria-label="Photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- full-size view from the image store */}
          <img src={photoAt(lightbox, 2000)} alt="" />
          <div className={styles.lightboxBar}>
            <a href={lightbox} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              Full size
            </a>
            <button type="button" onClick={() => setLightbox(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.tone === "error" ? styles.toastError : ""}`} role="status">
          <span>{toast.text}</span>
          {toast.jobId && (
            <>
              <label
                htmlFor={FIX_CAMERA}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setFixTarget(toast.jobId ?? null);
                  setToast(null);
                }}
              >
                Add photo of the fix
              </label>
              <button
                type="button"
                onClick={() => {
                  if (toast.jobId) reopen(toast.jobId);
                  setToast(null);
                }}
              >
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- new job / change a job ---------- */

function Composer({
  initial,
  onClose,
  onAdded,
  onEdit,
}: {
  initial: { mode: "new"; file?: File } | { mode: "edit"; task: TodoTask };
  onClose: () => void;
  onAdded: (task: TodoTask) => void;
  onEdit: (task: TodoTask, change: { text: string; area: string | null; urgent: boolean }) => void;
}) {
  const editing = initial.mode === "edit" ? initial.task : null;
  const [text, setText] = useState(editing?.text ?? "");
  const [area, setArea] = useState<string | null>(editing?.area ?? null);
  const [urgent, setUrgent] = useState(editing?.urgent ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot();
  const started = useRef<File | null>(null);

  // A photo taken from the main screen (or picked from the gallery) starts uploading at once.
  const fromOutside = initial.mode === "new" ? initial.file : undefined;
  useEffect(() => {
    if (fromOutside && started.current !== fromOutside) {
      started.current = fromOutside;
      start(fromOutside);
    }
  }, [fromOutside, start]);

  const save = async () => {
    setError("");
    if (editing) {
      onEdit(editing, { text: text.trim(), area, urgent });
      return;
    }
    if (!text.trim() && !slot) {
      setError("Take a photo or write what needs doing.");
      return;
    }
    setSaving(true);
    try {
      const photo = slot ? await settled() : null;
      if (slot && !photo) {
        setError("The photo didn't upload. Try it again, or remove it and save the note on its own.");
        return;
      }
      const { task } = (await send("/api/todo", "POST", { text: text.trim(), area, urgent, photoId: photo?.id ?? null })) as { task: TodoTask };
      clear(true);
      onAdded(task);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (!editing) clear();
    onClose();
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={editing ? "Change this job" : "New job"}>
        <h2 className={styles.sheetTitle}>{editing ? "Change this job" : "New job"}</h2>

        {editing ? (
          editing.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store
            <img className={styles.sheetPhoto} src={photoAt(editing.photoUrl, 900)} alt="" />
          )
        ) : slot ? (
          <div className={styles.slot}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the phone's own preview of the photo */}
            <img className={styles.sheetPhoto} src={slot.preview} alt="" />
            <p className={slot.state === "error" ? styles.slotError : styles.slotState}>
              {slot.state === "uploading" ? "Uploading the photo…" : slot.state === "ready" ? "Photo ready" : slot.error}
            </p>
            <div className={styles.slotButtons}>
              <label htmlFor="todo-sheet-camera" role="button" tabIndex={0}>
                Retake
              </label>
              <button type="button" onClick={() => clear()}>
                Remove photo
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.slotButtons}>
            <label htmlFor="todo-sheet-camera" role="button" tabIndex={0}>
              📷 Take photo
            </label>
            <label htmlFor={NEW_GALLERY} role="button" tabIndex={0}>
              From the gallery
            </label>
          </div>
        )}
        <input
          id="todo-sheet-camera"
          data-picker="sheet"
          className={styles.hiddenInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) start(file);
          }}
        />

        <label className={styles.label} htmlFor="todo-text">
          What needs doing?
        </label>
        <textarea
          id="todo-text"
          className={styles.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_TEXT}
          rows={3}
          placeholder="e.g. Fill the gap under the window frame before plastering"
        />

        <span className={styles.label}>Floor</span>
        <div className={styles.chips}>
          {AREAS.map((a) => (
            <button key={a} type="button" className={area === a ? styles.chipOn : styles.chip} aria-pressed={area === a} onClick={() => setArea(area === a ? null : a)}>
              {a}
            </button>
          ))}
        </div>

        <button type="button" className={urgent ? styles.urgentOn : styles.urgentOff} aria-pressed={urgent} onClick={() => setUrgent(!urgent)}>
          {urgent ? "Urgent ✓" : "Mark as urgent"}
        </button>

        {error && <p className={styles.sheetError}>{error}</p>}

        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={cancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving}>
            {saving ? (slot?.state === "uploading" ? "Uploading…" : "Saving…") : editing ? "Save" : "Add to the list"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- photo of the fix / note on a done job ---------- */

function ProofSheet({
  task,
  file,
  noteOnly,
  onClose,
  onSave,
}: {
  task: TodoTask;
  file?: File;
  noteOnly?: boolean;
  onClose: () => void;
  onSave: (note: string, photo: { id: string; url: string } | null) => Promise<void>;
}) {
  const [note, setNote] = useState(task.doneNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot();
  const started = useRef<File | null>(null);

  useEffect(() => {
    if (file && started.current !== file) {
      started.current = file;
      start(file);
    }
  }, [file, start]);

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const photo = slot ? await settled() : null;
      if (slot && !photo) {
        setError("The photo didn't upload. Try again.");
        return;
      }
      clear(true);
      await onSave(note.trim(), photo);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="The finished job">
        <h2 className={styles.sheetTitle}>{noteOnly ? "Note on the finished job" : "Photo of the fix"}</h2>
        <p className={styles.sheetNote}>{task.text || areaLabel(task.area)}</p>

        {!noteOnly &&
          (slot ? (
            <div className={styles.slot}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the phone's own preview of the photo */}
              <img className={styles.sheetPhoto} src={slot.preview} alt="" />
              <p className={slot.state === "error" ? styles.slotError : styles.slotState}>
                {slot.state === "uploading" ? "Uploading the photo…" : slot.state === "ready" ? "Photo ready" : slot.error}
              </p>
              <div className={styles.slotButtons}>
                <label htmlFor="todo-proof-camera" role="button" tabIndex={0}>
                  Retake
                </label>
              </div>
            </div>
          ) : (
            <div className={styles.slotButtons}>
              <label htmlFor="todo-proof-camera" role="button" tabIndex={0}>
                📷 Take photo
              </label>
            </div>
          ))}
        <input
          id="todo-proof-camera"
          data-picker="proof"
          className={styles.hiddenInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) start(f);
          }}
        />

        <label className={styles.label} htmlFor="todo-note">
          Note (optional)
        </label>
        <textarea
          id="todo-note"
          className={styles.textarea}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_NOTE}
          rows={2}
          placeholder="e.g. Done with the new sealant"
        />

        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button
            type="button"
            className={styles.sheetCancel}
            onClick={() => {
              clear();
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving || (!noteOnly && !slot && !note.trim())}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
