"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FLOORS, money } from "@/lib/expenses/shared";
import {
  atReorderPoint,
  fmtQty,
  MAX_ITEM_NAME,
  MAX_MOVE_NOTE,
  MAX_PERSON,
  MAX_UNIT,
  needsReorder,
  qtyUnit,
  UNDO_MINUTES,
  UNITS,
  type MoveKind,
  type StoreEntry,
  type StoreItem,
} from "@/lib/store/shared";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { dayName, errorText, send, startPolling, when } from "./api";
import { QtyPicker } from "./QtyPicker";
import site from "./Site.module.css";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import styles from "./Todo.module.css";
import { useUploadSlot } from "./useUploadSlot";

type Tab = "stock" | "reorder" | "history";
type Sheet = { kind: "item"; id: string } | { kind: "move"; id: string; move: MoveKind } | { kind: "new" } | { kind: "edit"; id: string };
type ToastData = { text: string; tone?: "error"; undo?: string };
type StoreData = { items: StoreItem[]; history: StoreEntry[] };

const MOVE_TITLE: Record<MoveKind, string> = { out: "Take out", back: "Brought back", in: "Add stock", count: "Count" };
const MOVE_DONE: Record<MoveKind, string> = { out: "Taken out", back: "Brought back", in: "Added", count: "Counted" };
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const minutesSince = (iso: string) => (Date.now() - Date.parse(iso)) / 60_000;

function counted(diff: number, unit: string) {
  if (diff === 0) return "Matches the record";
  return diff < 0 ? `${qtyUnit(-diff, unit)} missing` : `${qtyUnit(diff, unit)} more than the record`;
}

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

/** One line in a history list: what moved, how much, and who. */
function EntryLine({ entry, item, showName, isAdmin }: { entry: StoreEntry; item: StoreItem | undefined; showName: boolean; isAdmin: boolean }) {
  const unit = item?.unit ?? "";
  const name = showName ? ` · ${item?.name ?? "Item no longer in the store"}` : "";
  let head: React.ReactNode;
  let sub: string[] = [];
  let tone = "";
  if (entry.kind === "count") {
    head = (
      <>
        {entry.opening ? "Starting count" : "Count"}: {qtyUnit(entry.qty, unit)}
        {name}
      </>
    );
    if (!entry.opening && entry.diff !== null) {
      sub.push(counted(entry.diff, unit));
      tone = entry.diff < 0 ? site.entryBad : entry.diff > 0 ? site.entryOdd : site.entryGood;
    }
  } else {
    head = (
      <>
        <span className={entry.kind === "out" ? site.minus : site.plus}>
          {entry.kind === "out" ? "−" : "+"}
          {qtyUnit(entry.qty, unit)}
        </span>
        {name}
      </>
    );
    if (entry.kind === "bought") {
      sub.push("Bought");
      if (isAdmin && entry.amount !== undefined) sub.push(money(entry.amount));
      if (isAdmin && entry.supplier) sub.push(entry.supplier);
      if (entry.date) sub.push(`paid ${new Date(entry.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`);
    }
    if (entry.kind === "back") sub.push("Brought back");
    if (entry.kind === "in") sub.push("Added by the office");
    if (entry.floor) sub.push(entry.floor);
    if (entry.person) sub.push(entry.kind === "out" ? `taken by ${entry.person}` : `by ${entry.person}`);
  }
  if (entry.note) sub.push(`“${entry.note}”`);
  sub = sub.filter(Boolean);
  return (
    <div className={site.entryText}>
      <p className={site.entryHead}>{head}</p>
      {sub.length > 0 && <p className={`${site.entrySub} ${tone}`}>{sub.join(" · ")}</p>}
      <p className={site.entryWho}>
        {entry.by ? `${entry.kind === "bought" ? "Logged" : "Recorded"} by ${entry.by} · ` : ""}
        {time(entry.at)}
      </p>
    </div>
  );
}

/** A photo taken with an entry, small; tap for the big one. */
function EntryPhoto({ url, onOpen }: { url: string | null | undefined; onOpen: (url: string) => void }) {
  if (!url) return null;
  return (
    <button type="button" className={site.entryThumb} onClick={() => onOpen(url)} aria-label="Open the photo">
      {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
      <img src={photoAt(url, 160)} alt="" loading="lazy" />
    </button>
  );
}

export function StoreApp({
  me,
  active,
  initial,
  startedOffline,
  onReorders,
  fresh,
}: {
  me: TodoMe;
  /** On screen: only then does it keep itself fresh. */
  active: boolean;
  /** Null when the app opened on another part and the store hasn't arrived yet. */
  initial: StoreData | null;
  startedOffline: boolean;
  /** How many items are on the reorder list (for the badge on the bar). */
  onReorders: (count: number) => void;
  /** The page came with this part's data just now (it's the part the app opened on). */
  fresh: boolean;
}) {
  const isAdmin = me.kind === "admin";
  const [items, setItems] = useState(initial?.items ?? []);
  const [history, setHistory] = useState(initial?.history ?? []);
  const [loaded, setLoaded] = useState(initial !== null);
  const [tab, setTab] = useState<Tab>("stock");
  const [search, setSearch] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  // An answer that left the server before this phone's last change would show the old number for
  // a moment: such answers are skipped (the next one is only seconds away).
  const localAt = useRef(0);
  const inFlight = useRef(false);
  const lastServer = useRef("");
  const lastLoadedAt = useRef(0);
  const skipFirst = useRef(fresh);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((data: ToastData) => {
    clearTimeout(toastTimer.current);
    setToast(data);
    toastTimer.current = setTimeout(() => setToast(null), data.undo ? 7000 : 3500);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/store", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error("refresh failed");
      const text = await response.text();
      lastLoadedAt.current = Date.now();
      setLoaded(true);
      setOffline(false);
      // Unchanged: leave the screen alone.
      if (text === lastServer.current || startedAt < localAt.current) return;
      lastServer.current = text;
      const data = JSON.parse(text) as StoreData;
      setItems(data.items);
      setHistory(data.history);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Live while on screen: every 10 seconds while someone is using it, every minute when it just
  // sits open (each look is a request on the database's monthly allowance).
  useEffect(() => {
    if (!active) return;
    // Opened on this part: what the page came with is fresh. Otherwise look again at once.
    if (skipFirst.current) skipFirst.current = false;
    else if (Date.now() - lastLoadedAt.current > 4_000) void refresh();
    return startPolling(refresh, 10_000, 60_000);
  }, [active, refresh]);

  const reorderCount = useMemo(() => items.filter(needsReorder).length, [items]);
  useEffect(() => onReorders(reorderCount), [reorderCount, onReorders]);

  const applyItem = useCallback((item: StoreItem | null, entry?: StoreEntry, removed?: string) => {
    localAt.current = Date.now();
    if (item) {
      setItems((list) =>
        (list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item]).sort((a, b) =>
          a.name.localeCompare(b.name, "en", { sensitivity: "base" })
        )
      );
    }
    if (entry) setHistory((list) => [entry, ...list.filter((e) => e.id !== entry.id)]);
    if (removed) setHistory((list) => list.filter((e) => e.id !== removed));
  }, []);

  const undo = useCallback(
    async (id: string) => {
      setArmed(null);
      try {
        const { item } = await send<{ item: StoreItem | null }>(`/api/store/moves/${id}`, "DELETE");
        applyItem(item, undefined, id);
        showToast({ text: "Taken off the record" });
      } catch (e) {
        if ((e as { status?: number }).status === 401) setSignedOut(true);
        showToast({ text: errorText(e), tone: "error" });
      }
    },
    [applyItem, showToast]
  );

  const changeItem = useCallback(
    async (item: StoreItem, change: Record<string, unknown>, done: string) => {
      try {
        const { item: saved } = await send<{ item: StoreItem }>(`/api/store/items/${item.id}`, "PATCH", change);
        applyItem(saved);
        showToast({ text: done });
      } catch (e) {
        showToast({ text: errorText(e), tone: "error" });
      }
    },
    [applyItem, showToast]
  );

  /* ---------- what to show ---------- */

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const stocked = useMemo(() => items.filter((i) => i.stocked), [items]);
  const hidden = useMemo(() => items.filter((i) => !i.stocked), [items]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stocked.filter((i) => !q || i.name.toLowerCase().includes(q));
  }, [stocked, search]);
  const toReorder = useMemo(() => stocked.filter(needsReorder), [stocked]);
  const dismissed = useMemo(() => stocked.filter((i) => atReorderPoint(i) && i.reorderDismissed), [stocked]);
  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of history) if (e.person && !seen.has(e.person.toLowerCase())) seen.set(e.person.toLowerCase(), e.person);
    return [...seen.values()].slice(0, 6);
  }, [history]);
  const days = useMemo(() => {
    const groups: { day: string; entries: StoreEntry[] }[] = [];
    for (const e of history) {
      const day = dayName(e.at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.entries.push(e);
      else groups.push({ day, entries: [e] });
    }
    return groups;
  }, [history]);

  const canUndo = (e: StoreEntry) => e.kind !== "bought" && (isAdmin || (e.mine && minutesSince(e.at) < UNDO_MINUTES));
  const current = sheet && "id" in sheet ? byId.get(sheet.id) : undefined;

  const orderText = () =>
    [
      `Lexington site: to order (${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })})`,
      ...toReorder.map((i) => `• ${i.name}: ${i.reorderQty ? qtyUnit(i.reorderQty, i.unit) : "how many?"} (${qtyUnit(Math.max(0, i.level), i.unit)} left)`),
    ].join("\n");
  const copyOrder = async () => {
    try {
      await navigator.clipboard.writeText(orderText());
      showToast({ text: "Order list copied: paste it in WhatsApp" });
    } catch {
      showToast({ text: "Couldn't copy here. Long-press the list instead.", tone: "error" });
    }
  };

  const itemRow = (item: StoreItem) => {
    const flag = item.level < 0 ? "Below zero: count it" : atReorderPoint(item) ? (item.reorderDismissed ? "Low (no reorder needed)" : "Time to reorder") : null;
    return (
      <button key={item.id} type="button" className={site.itemRow} onClick={() => setSheet({ kind: "item", id: item.id })}>
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store
          <img className={site.itemThumb} src={photoAt(item.photoUrl, 120)} alt="" loading="lazy" />
        ) : (
          <span className={site.itemThumbEmpty} aria-hidden="true">
            <CameraIcon />
          </span>
        )}
        <span className={site.itemName}>
          {item.name}
          <small className={item.level < 0 ? site.flagBad : flag ? site.flagLow : undefined}>
            {flag ?? (item.lastCountAt ? `Counted ${when(item.lastCountAt)}` : "Not counted yet")}
          </small>
        </span>
        <span className={item.level < 0 ? site.levelBad : atReorderPoint(item) ? site.levelLow : site.level}>
          {fmtQty(item.level)} <small>{item.unit}</small>
        </span>
      </button>
    );
  };

  return (
    <>
      <SiteHeader title="Store room" sub={`${stocked.length} item${stocked.length === 1 ? "" : "s"} · ${toReorder.length} to reorder`} onMenu={() => setMenuOpen(true)}>
        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === "stock"} className={tab === "stock" ? styles.tabOn : styles.tab} onClick={() => setTab("stock")}>
            Stock
          </button>
          <button type="button" role="tab" aria-selected={tab === "reorder"} className={tab === "reorder" ? styles.tabOn : styles.tab} onClick={() => setTab("reorder")}>
            Reorder {toReorder.length > 0 && <span className={styles.tabCount}>{toReorder.length}</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? styles.tabOn : styles.tab} onClick={() => setTab("history")}>
            Moved
          </button>
        </div>
      </SiteHeader>

      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/store">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the store as it was. It updates by itself when the signal is back.
        </div>
      )}

      <main className={styles.main}>
        {!loaded && <p className={styles.loading}>Loading the store…</p>}

        {loaded && tab === "stock" && (
          <>
            <div className={site.findBar}>
              <input
                className={styles.input}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find an item…"
                aria-label="Find an item"
                enterKeyHint="search"
              />
              <button type="button" className={site.newButton} onClick={() => setSheet({ kind: "new" })}>
                + New item
              </button>
            </div>
            {shown.length === 0 ? (
              <p className={styles.empty}>
                {stocked.length === 0
                  ? "Nothing in the store yet. Tap + New item for each thing on the shelves, take a photo and say how many there are. Materials bought from now on come in by themselves when the office logs the payment."
                  : "Nothing matches."}
              </p>
            ) : (
              <div className={site.itemList}>{shown.map(itemRow)}</div>
            )}
            {isAdmin && hidden.length > 0 && (
              <section className={styles.group}>
                <button type="button" className={styles.linkButton} onClick={() => setShowHidden(!showHidden)}>
                  {showHidden ? "Hide" : "Show"} {hidden.length} not kept in the store
                </button>
                {showHidden && <div className={site.itemList}>{hidden.map(itemRow)}</div>}
              </section>
            )}
          </>
        )}

        {loaded && tab === "reorder" && (
          <>
            {toReorder.length === 0 ? (
              <p className={styles.empty}>
                Nothing to reorder. Items come here when they&rsquo;re down to their reorder point
                {isAdmin ? ": set one on the item (tap it, then Change)." : "."}
              </p>
            ) : (
              <>
                <button type="button" className={site.copyList} onClick={() => void copyOrder()}>
                  Copy the order list for WhatsApp
                </button>
                {toReorder.map((item) => (
                  <article key={item.id} className={`${site.reorderCard} ${item.level <= 0 ? site.reorderCardOut : ""}`}>
                    <div className={site.reorderTop}>
                      {item.photoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store
                        <img className={site.itemThumb} src={photoAt(item.photoUrl, 120)} alt="" loading="lazy" />
                      )}
                      <button type="button" className={site.reorderName} onClick={() => setSheet({ kind: "item", id: item.id })}>
                        {item.name}
                      </button>
                      <span className={item.level <= 0 ? site.levelBad : site.levelLow}>
                        {fmtQty(item.level)} <small>{item.unit}</small>
                      </span>
                    </div>
                    <p className={site.reorderLine}>
                      {item.level <= 0 ? "None left" : `${qtyUnit(item.level, item.unit)} left`} · reorder at {qtyUnit(item.low ?? 0, item.unit)}
                    </p>
                    <p className={site.reorderOrder}>{item.reorderQty ? `Order ${qtyUnit(item.reorderQty, item.unit)}` : "Order quantity not set"}</p>
                    {isAdmin && (
                      <div className={site.reorderButtons}>
                        <button type="button" onClick={() => void changeItem(item, { reorderDismissed: true }, `${item.name}: no reorder this time`)}>
                          No need to reorder
                        </button>
                        <button type="button" onClick={() => setSheet({ kind: "edit", id: item.id })}>
                          Change
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </>
            )}
            {dismissed.length > 0 && (
              <section className={styles.group}>
                <button type="button" className={styles.linkButton} onClick={() => setShowDismissed(!showDismissed)}>
                  {showDismissed ? "Hide" : "Show"} {dismissed.length} marked &ldquo;no need to reorder&rdquo;
                </button>
                {showDismissed &&
                  dismissed.map((item) => (
                    <article key={item.id} className={site.reorderCard}>
                      <div className={site.reorderTop}>
                        <button type="button" className={site.reorderName} onClick={() => setSheet({ kind: "item", id: item.id })}>
                          {item.name}
                        </button>
                        <span className={site.levelLow}>
                          {fmtQty(item.level)} <small>{item.unit}</small>
                        </span>
                      </div>
                      <p className={site.reorderLine}>Comes back by itself once it&rsquo;s restocked and runs low again.</p>
                      {isAdmin && (
                        <div className={site.reorderButtons}>
                          <button type="button" onClick={() => void changeItem(item, { reorderDismissed: false }, `${item.name} is back on the reorder list`)}>
                            Put back on the list
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
              </section>
            )}
          </>
        )}

        {loaded &&
          tab === "history" &&
          (days.length === 0 ? (
            <p className={styles.empty}>Everything that comes in, goes out or is counted shows here, newest first.</p>
          ) : (
            days.map((group) => (
              <section key={group.day} className={styles.group}>
                <h2 className={styles.groupTitle}>
                  {group.day} <span>{group.entries.length}</span>
                </h2>
                {group.entries.map((entry) => (
                  <article key={entry.id} className={site.entry}>
                    <EntryLine entry={entry} item={byId.get(entry.itemId)} showName isAdmin={isAdmin} />
                    <EntryPhoto url={entry.photoUrl} onOpen={setLightbox} />
                    {canUndo(entry) && (
                      <button
                        type="button"
                        className={armed === entry.id ? styles.dangerArmed : site.entryUndo}
                        onClick={() => (armed === entry.id ? void undo(entry.id) : setArmed(entry.id))}
                      >
                        {armed === entry.id ? "Tap again" : isAdmin ? "Remove" : "Undo"}
                      </button>
                    )}
                  </article>
                ))}
              </section>
            ))
          ))}
      </main>

      {sheet?.kind === "item" && current && (
        <ItemSheet
          key={current.id}
          item={current}
          me={me}
          recent={history.filter((e) => e.itemId === current.id)}
          onClose={() => setSheet(null)}
          onMove={(move) => setSheet({ kind: "move", id: current.id, move })}
          onEdit={() => setSheet({ kind: "edit", id: current.id })}
          onUndo={undo}
          onPhoto={(item) => {
            applyItem(item);
            showToast({ text: "Photo saved" });
          }}
          onOpenPhoto={setLightbox}
        />
      )}
      {sheet?.kind === "move" && current && (
        <MoveSheet
          key={`${current.id}-${sheet.move}`}
          item={current}
          move={sheet.move}
          people={people}
          onClose={() => setSheet({ kind: "item", id: current.id })}
          onSaved={(item, entry) => {
            applyItem(item, entry);
            setSheet(null);
            const what =
              entry.kind === "count" ? `Counted ${current.name}: ${qtyUnit(entry.qty, current.unit)}` : `${MOVE_DONE[sheet.move]}: ${qtyUnit(entry.qty, current.unit)} ${current.name}`;
            const gap = entry.kind === "count" && entry.diff ? ` · ${counted(entry.diff, current.unit)}` : "";
            showToast({ text: what + gap, undo: entry.id });
          }}
          onSignedOut={() => setSignedOut(true)}
        />
      )}
      {sheet?.kind === "new" && (
        <NewItemSheet
          items={items}
          onClose={() => setSheet(null)}
          onSaved={(item) => {
            applyItem(item);
            setSheet(null);
            setSearch("");
            showToast({ text: `Added ${item.name}: ${qtyUnit(item.level, item.unit)}` });
          }}
        />
      )}
      {sheet?.kind === "edit" && current && isAdmin && (
        <EditItemSheet
          key={current.id}
          item={current}
          onClose={() => setSheet({ kind: "item", id: current.id })}
          onSaved={(item) => {
            applyItem(item);
            setSheet(item.stocked ? { kind: "item", id: item.id } : null);
            showToast({ text: item.stocked ? "Saved" : `${item.name} is no longer kept in the store` });
          }}
        />
      )}

      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
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
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                if (toast.undo) void undo(toast.undo);
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* ---------- a photo to go with something (the store's own uploads) ---------- */

function PhotoField({
  idBase,
  slot,
  onPick,
  onClear,
  required,
  cameraOnly,
  label,
}: {
  idBase: string;
  slot: ReturnType<typeof useUploadSlot>["slot"];
  onPick: (file: File) => void;
  onClear: () => void;
  required?: boolean;
  cameraOnly?: boolean;
  label: string;
}) {
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onPick(file);
  };
  return (
    <div className={site.photoBox}>
      <span className={styles.label}>{label}</span>
      {slot ? (
        <>
          <span className={site.photoPreview}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the phone's own preview of the photo */}
            <img src={slot.preview} alt="" />
          </span>
          <p className={slot.state === "error" ? styles.slotError : site.photoState}>
            {slot.state === "uploading" ? "Uploading the photo…" : slot.state === "ready" ? "Photo ready" : slot.error}
          </p>
          <div className={styles.slotButtons}>
            <label htmlFor={`${idBase}-camera`} role="button" tabIndex={0}>
              Retake
            </label>
            {!required && (
              <button type="button" onClick={onClear}>
                Remove photo
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {required && <p className={site.photoNeeded}>A photo of the stock going out is needed.</p>}
          <div className={styles.slotButtons}>
            <label htmlFor={`${idBase}-camera`} role="button" tabIndex={0}>
              📷 Take photo
            </label>
            {!cameraOnly && (
              <label htmlFor={`${idBase}-gallery`} role="button" tabIndex={0}>
                From the gallery
              </label>
            )}
          </div>
        </>
      )}
      <input id={`${idBase}-camera`} data-picker={`${idBase}-camera`} className={styles.hiddenInput} type="file" accept="image/*" capture="environment" onChange={pick} />
      {!cameraOnly && <input id={`${idBase}-gallery`} data-picker={`${idBase}-gallery`} className={styles.hiddenInput} type="file" accept="image/*" onChange={pick} />}
    </div>
  );
}

/* ---------- one item: its stock, its photo, what to do with it, its history ---------- */

function ItemSheet({
  item,
  me,
  recent,
  onClose,
  onMove,
  onEdit,
  onUndo,
  onPhoto,
  onOpenPhoto,
}: {
  item: StoreItem;
  me: TodoMe;
  /** What already loaded for this item: shown at once while the whole history comes. */
  recent: StoreEntry[];
  onClose: () => void;
  onMove: (move: MoveKind) => void;
  onEdit: () => void;
  onUndo: (id: string) => Promise<void>;
  onPhoto: (item: StoreItem) => void;
  onOpenPhoto: (url: string) => void;
}) {
  const isAdmin = me.kind === "admin";
  const [full, setFull] = useState<StoreEntry[] | null>(null);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const level = item.level;
  const entries = full ?? recent;

  // The whole history of this item; asked again whenever its stock changes on screen.
  useEffect(() => {
    let live = true;
    fetch(`/api/store/items/${item.id}`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Couldn't load everything that moved. Check your signal.");
        if (live) setFull(data.history as StoreEntry[]);
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [item.id, level]);

  const gaps = useMemo(() => {
    let missing = 0;
    let extra = 0;
    for (const e of entries) {
      if (e.kind !== "count" || e.opening || !e.diff) continue;
      if (e.diff < 0) missing -= e.diff;
      else extra += e.diff;
    }
    return { missing, extra };
  }, [entries]);

  // A new photo of the stock: upload, then put it on the item.
  const { start, settled, clear } = useUploadSlot("/api/store/photo");
  const newPhoto = async (file: File) => {
    setPhotoBusy(true);
    setError("");
    start(file);
    try {
      const stored = await settled();
      if (!stored) throw new Error("The photo didn't upload. Try again.");
      const { item: saved } = await send<{ item: StoreItem }>(`/api/store/items/${item.id}`, "PATCH", { photoId: stored.id });
      clear(true);
      onPhoto(saved);
    } catch (e) {
      clear();
      setError(errorText(e));
    } finally {
      setPhotoBusy(false);
    }
  };
  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void newPhoto(file);
  };

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={`${styles.sheet} ${site.sheetTall}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={item.name}>
        <div className={site.itemHead}>
          <h2 className={styles.sheetTitle}>{item.name}</h2>
          {isAdmin && (
            <button type="button" className={styles.linkButton} onClick={onEdit}>
              Change
            </button>
          )}
        </div>
        <div className={site.itemPhotoRow}>
          {item.photoUrl ? (
            <button type="button" className={site.itemPhoto} onClick={() => onOpenPhoto(item.photoUrl!)} aria-label="Open the photo">
              {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
              <img src={photoAt(item.photoUrl, 240)} alt="" />
            </button>
          ) : (
            <label htmlFor="store-item-camera" className={site.itemPhotoAdd} role="button" tabIndex={0}>
              <CameraIcon />
              {photoBusy ? "Saving…" : "Add photo"}
            </label>
          )}
          <div>
            <p className={item.level < 0 ? site.bigLevelBad : atReorderPoint(item) ? site.bigLevelLow : site.bigLevel}>
              {fmtQty(item.level)} <small>{item.unit}</small>
            </p>
            <p className={styles.sheetNote}>In the store by the record.</p>
            {item.photoUrl && (
              <label htmlFor="store-item-camera" className={styles.linkButton} role="button" tabIndex={0}>
                {photoBusy ? "Saving the photo…" : "New photo"}
              </label>
            )}
          </div>
        </div>
        <input id="store-item-camera" data-picker="store-item-camera" className={styles.hiddenInput} type="file" accept="image/*" capture="environment" onChange={pickPhoto} />
        <p className={styles.sheetNote}>
          {item.level < 0
            ? "Below zero: more went out than came in. A purchase may not be logged yet, or count it."
            : item.low !== null
              ? `Reorder when down to ${qtyUnit(item.low, item.unit)}${item.reorderQty ? `, order ${qtyUnit(item.reorderQty, item.unit)}` : ""}.`
              : isAdmin
                ? "No reorder point yet: tap Change to set one."
                : ""}
          {!item.stocked && " Not kept in the store."}
        </p>
        {(gaps.missing > 0 || gaps.extra > 0) && (
          <p className={gaps.missing > 0 ? site.gapBad : site.gapOdd}>
            Counts so far: {gaps.missing > 0 ? `${qtyUnit(gaps.missing, item.unit)} missing` : ""}
            {gaps.missing > 0 && gaps.extra > 0 ? ", " : ""}
            {gaps.extra > 0 ? `${qtyUnit(gaps.extra, item.unit)} more than the record` : ""}
          </p>
        )}

        <button type="button" className={site.bigAction} onClick={() => onMove("out")}>
          Take out
        </button>
        <div className={site.actionRow}>
          <button type="button" onClick={() => onMove("back")}>
            Brought back
          </button>
          <button type="button" onClick={() => onMove("count")}>
            Count
          </button>
          {isAdmin && (
            <button type="button" onClick={() => onMove("in")}>
              Add stock
            </button>
          )}
        </div>

        <p className={styles.label}>What moved</p>
        {error && <p className={styles.sheetError}>{error}</p>}
        {entries.length === 0 ? (
          <p className={styles.sheetNote}>{full === null && !error ? "Loading…" : "Nothing yet."}</p>
        ) : (
          <div className={site.sheetEntries}>
            {entries.map((entry) => (
              <article key={entry.id} className={site.entry}>
                <div className={site.entryDate}>{new Date(entry.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                <EntryLine entry={entry} item={item} showName={false} isAdmin={isAdmin} />
                <EntryPhoto url={entry.photoUrl} onOpen={onOpenPhoto} />
                {entry.kind !== "bought" && (isAdmin || (entry.mine && minutesSince(entry.at) < UNDO_MINUTES)) && (
                  <button
                    type="button"
                    className={armed === entry.id ? styles.dangerArmed : site.entryUndo}
                    onClick={() => (armed === entry.id ? void onUndo(entry.id) : setArmed(entry.id))}
                  >
                    {armed === entry.id ? "Tap again" : isAdmin ? "Remove" : "Undo"}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
        <button type="button" className={styles.sheetCancel} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ---------- take out / bring back / add / count ---------- */

function MoveSheet({
  item,
  move,
  people,
  onClose,
  onSaved,
  onSignedOut,
}: {
  item: StoreItem;
  move: MoveKind;
  people: string[];
  onClose: () => void;
  onSaved: (item: StoreItem, entry: StoreEntry) => void;
  onSignedOut: () => void;
}) {
  const counting = move === "count";
  const moving = move === "out" || move === "back";
  // Niko, 23 Oct 2026: stock going out always with a photo (taken there and then); anything else may have one.
  const photoNeeded = move === "out";
  const [qty, setQty] = useState(1);
  const [countText, setCountText] = useState("");
  const [floor, setFloor] = useState<string | null>(null);
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot("/api/store/photo");

  const countValue = countText.trim() === "" ? NaN : Number(countText);
  const diff = Number.isFinite(countValue) ? Math.round((countValue - item.level) * 1000) / 1000 : null;

  const save = async () => {
    setError("");
    if (counting && !(Number.isFinite(countValue) && countValue >= 0)) {
      setError("Type how many are there (0 if none).");
      return;
    }
    if (photoNeeded && !slot) {
      setError("Take a photo of what's going out first.");
      return;
    }
    setSaving(true);
    try {
      const photo = slot ? await settled() : null;
      if (slot && !photo) {
        setError("The photo didn't upload. Take it again.");
        return;
      }
      const { item: after, entry } = await send<{ item: StoreItem; entry: StoreEntry }>("/api/store", "POST", {
        kind: move,
        itemId: item.id,
        qty: counting ? countValue : qty,
        floor,
        person: person.trim(),
        note: note.trim(),
        photoId: photo?.id ?? null,
      });
      clear(true);
      onSaved(after, entry);
    } catch (e) {
      if ((e as { status?: number }).status === 401) onSignedOut();
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={`${MOVE_TITLE[move]}: ${item.name}`}>
        <h2 className={styles.sheetTitle}>
          {MOVE_TITLE[move]}: {item.name}
        </h2>
        <p className={styles.sheetNote}>
          By the record there {item.level === 1 ? "is" : "are"} {qtyUnit(item.level, item.unit)} in the store.
        </p>

        <PhotoField
          idBase="store-move"
          slot={slot}
          onPick={start}
          onClear={() => clear()}
          required={photoNeeded}
          cameraOnly={photoNeeded}
          label={photoNeeded ? "Photo of what's going out" : counting ? "Photo of the shelf (optional)" : "Photo (optional)"}
        />

        {counting ? (
          <>
            <label className={styles.label} htmlFor="store-count">
              How many are on the shelf?
            </label>
            <input
              id="store-count"
              className={`${styles.input} ${site.countInput}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={countText}
              onChange={(e) => setCountText(e.target.value)}
              placeholder={fmtQty(Math.max(0, item.level))}
            />
            {diff !== null && <p className={diff < 0 ? site.gapBad : diff > 0 ? site.gapOdd : site.gapGood}>{counted(diff, item.unit)}</p>}
          </>
        ) : (
          <>
            <span className={styles.label}>How many?</span>
            <QtyPicker id="store-qty" value={qty} onChange={setQty} unit={item.unit} />
            {move === "out" && qty > item.level && item.level >= 0 && (
              <p className={site.gapOdd}>That&rsquo;s more than the record says is there. Save it anyway if it&rsquo;s right.</p>
            )}
          </>
        )}

        {moving && (
          <>
            <span className={styles.label}>{move === "out" ? "Where is it going?" : "From where?"}</span>
            <div className={styles.chips}>
              {FLOORS.map((f) => (
                <button key={f} type="button" className={floor === f ? styles.chipOn : styles.chip} aria-pressed={floor === f} onClick={() => setFloor(floor === f ? null : f)}>
                  {f}
                </button>
              ))}
            </div>
            <label className={styles.label} htmlFor="store-person">
              {move === "out" ? "Who took it?" : "Who brought it back?"}
            </label>
            <input
              id="store-person"
              className={styles.input}
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              maxLength={MAX_PERSON}
              autoComplete="off"
              autoCapitalize="words"
              placeholder="e.g. Kofi (mason)"
            />
            {people.length > 0 && (
              <div className={styles.chips}>
                {people.map((p) => (
                  <button key={p} type="button" className={person === p ? styles.chipOn : styles.chip} onClick={() => setPerson(person === p ? "" : p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <label className={styles.label} htmlFor="store-note">
          {move === "in" ? "Where it came from" : "Note (optional)"}
        </label>
        <input
          id="store-note"
          className={styles.input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_MOVE_NOTE}
          autoComplete="off"
          placeholder={move === "in" ? "e.g. Bought before the store was set up" : move === "count" ? "e.g. 2 bags hard, set aside" : "e.g. For the 3rd floor columns"}
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
          <button
            type="button"
            className={styles.sheetSave}
            onClick={() => void save()}
            disabled={saving || (counting && countText.trim() === "") || (photoNeeded && slot?.state !== "ready")}
          >
            {saving
              ? "Saving…"
              : photoNeeded && !slot
                ? "Take the photo first"
                : photoNeeded && slot?.state === "uploading"
                  ? "Uploading the photo…"
                  : counting
                    ? "Save the count"
                    : `${MOVE_TITLE[move]} ${qtyUnit(qty, item.unit)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- something new on the shelves ---------- */

function UnitPicker({ value, onChange, id }: { value: string; onChange: (unit: string) => void; id: string }) {
  const custom = !(UNITS as readonly string[]).includes(value);
  return (
    <>
      <div className={styles.chips}>
        {UNITS.map((u) => (
          <button key={u} type="button" className={value === u ? styles.chipOn : styles.chip} aria-pressed={value === u} onClick={() => onChange(u)}>
            {u}
          </button>
        ))}
      </div>
      <input
        id={id}
        className={styles.input}
        value={custom ? value : ""}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        maxLength={MAX_UNIT}
        autoComplete="off"
        placeholder="Or type one, e.g. bundles"
        aria-label="Another unit"
      />
    </>
  );
}

function NewItemSheet({ items, onClose, onSaved }: { items: StoreItem[]; onClose: () => void; onSaved: (item: StoreItem) => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [count, setCount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot("/api/store/photo");
  const clash = items.find((i) => i.name.toLowerCase() === name.trim().replace(/\s+/g, " ").toLowerCase());

  const save = async () => {
    setError("");
    if (!name.trim()) return setError("Type what it is, e.g. Cement 50kg.");
    if (count.trim() === "" || !(Number(count) >= 0)) return setError("Type how many are there now (0 if none).");
    setSaving(true);
    try {
      const photo = slot ? await settled() : null;
      if (slot && !photo) return setError("The photo didn't upload. Take it again, or remove it.");
      const { item } = await send<{ item: StoreItem }>("/api/store/items", "POST", {
        name: name.trim(),
        unit: unit.trim() || "pcs",
        count: Number(count),
        photoId: photo?.id ?? null,
      });
      clear(true);
      onSaved(item);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="New item in the store">
        <h2 className={styles.sheetTitle}>New item in the store</h2>
        <label className={styles.label} htmlFor="store-new-name">
          What is it?
        </label>
        <input
          id="store-new-name"
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_ITEM_NAME}
          autoComplete="off"
          autoCapitalize="sentences"
          placeholder="e.g. Cement 50kg"
        />
        {clash && <p className={site.gapOdd}>&ldquo;{clash.name}&rdquo; is already in the store: find it in the list and count it there.</p>}
        <PhotoField idBase="store-new" slot={slot} onPick={start} onClear={() => clear()} label="Photo of the stock (optional)" />
        <span className={styles.label}>Counted in</span>
        <UnitPicker id="store-new-unit" value={unit} onChange={setUnit} />
        <label className={styles.label} htmlFor="store-new-count">
          How many are there now?
        </label>
        <input
          id="store-new-count"
          className={`${styles.input} ${site.countInput}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          placeholder="e.g. 20"
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
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving || !!clash}>
            {saving ? "Saving…" : "Add to the store"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- the office: change an item ---------- */

function EditItemSheet({ item, onClose, onSaved }: { item: StoreItem; onClose: () => void; onSaved: (item: StoreItem) => void }) {
  const [name, setName] = useState(item.name);
  const [unit, setUnit] = useState(item.unit);
  const [low, setLow] = useState(item.low === null ? "" : String(item.low));
  const [reorderQty, setReorderQty] = useState(item.reorderQty === null ? "" : String(item.reorderQty));
  const [stocked, setStocked] = useState(item.stocked);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const { item: saved } = await send<{ item: StoreItem }>(`/api/store/items/${item.id}`, "PATCH", {
        name: name.trim(),
        unit: unit.trim() || "pcs",
        low: low.trim() === "" ? null : Number(low),
        reorderQty: reorderQty.trim() === "" ? null : Number(reorderQty),
        stocked,
      });
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={`Change ${item.name}`}>
        <h2 className={styles.sheetTitle}>Change {item.name}</h2>
        <label className={styles.label} htmlFor="store-edit-name">
          Name
        </label>
        <input id="store-edit-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_ITEM_NAME} autoComplete="off" />
        <p className={styles.sheetNote}>Purchases typed with the old name still come here.</p>
        <span className={styles.label}>Counted in</span>
        <UnitPicker id="store-edit-unit" value={unit} onChange={setUnit} />
        <label className={styles.label} htmlFor="store-edit-low">
          Reorder when down to
        </label>
        <input
          id="store-edit-low"
          className={`${styles.input} ${site.countInput}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={low}
          onChange={(e) => setLow(e.target.value)}
          placeholder="No reorder point"
        />
        <label className={styles.label} htmlFor="store-edit-reorder">
          How much to reorder (optional)
        </label>
        <input
          id="store-edit-reorder"
          className={`${styles.input} ${site.countInput}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={reorderQty}
          onChange={(e) => setReorderQty(e.target.value)}
          placeholder={`e.g. 100 ${unit}`}
        />
        <button type="button" className={stocked ? styles.chip : styles.chipOn} aria-pressed={!stocked} onClick={() => setStocked(!stocked)}>
          {stocked ? "Kept in the store" : "Not kept in the store ✓"}
        </button>
        <p className={styles.sheetNote}>
          &ldquo;Not kept in the store&rdquo; is for things used straight away (ready-mix, sand): they leave the stock list, and buying them doesn&rsquo;t add stock
          unless you say so on the expense.
        </p>
        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
