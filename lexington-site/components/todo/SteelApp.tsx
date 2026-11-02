"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { money } from "@/lib/expenses/shared";
import { STEEL_PARTS, type SteelBuy, type SteelData, type SteelInstall } from "@/lib/expenses/steel";
import type { TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { errorText, send, startPolling } from "./api";
import { niceDate } from "./ExpenseForm";
import { SiteHeader, SiteMenu } from "./SiteChrome";
import s from "./Steel.module.css";
import styles from "./Todo.module.css";

// The steel page (lib/expenses/steel.ts and lib/steel/server.ts say what and why): what the steel benders are owed
// for the tons bent and installed, less what they were paid; the steel bought and still in stock; and the tons
// installed, logged one entry at a time (where, what part, how many tons), with the entries behind every figure.

type ToastData = { text: string; tone?: "error" };
const tons = (n: number) => `${Math.round(n * 1000) / 1000} t`;
const cedis = (n: number) => money(n).replace(/\.00$/, "");
const todayGhana = () => new Date().toISOString().slice(0, 10);
const newestFirst = <T extends { date: string }>(list: readonly T[]) => [...list].sort((a, b) => b.date.localeCompare(a.date));

export function SteelApp({ me, active, initial, startedOffline, fresh }: { me: TodoMe; active: boolean; initial: SteelData | null; startedOffline: boolean; fresh: boolean }) {
  const [data, setData] = useState<SteelData | null>(initial);
  const [offline, setOffline] = useState(startedOffline);
  const [signedOut, setSignedOut] = useState(false);
  // The sheet for tons installed: a new entry (install null), or one to change.
  const [sheet, setSheet] = useState<{ install: SteelInstall | null } | null>(null);
  // Typed in place: "rate", or a steel buy's id (its tons).
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const inFlight = useRef(false);
  const lastLoadedAt = useRef(0);
  const localAt = useRef(0);
  const skipFirst = useRef(fresh);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((t: ToastData) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/steel", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as SteelData;
      lastLoadedAt.current = Date.now();
      setOffline(false);
      if (startedAt >= localAt.current) setData(next);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    if (skipFirst.current) skipFirst.current = false;
    else if (Date.now() - lastLoadedAt.current > 4_000) void refresh();
    return startPolling(refresh, 60_000, 180_000);
  }, [active, refresh]);

  const change = async (body: Record<string, unknown>, done: string) => {
    const next = await send<SteelData>("/api/steel", "POST", body);
    localAt.current = Date.now();
    setData(next);
    showToast({ text: done });
  };

  // The rate, or a buy's tons, typed in place.
  const quick = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await change(body, done);
      setEditing(null);
    } catch (e) {
      showToast({ text: errorText(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const tr = data?.tracker;
  const tonsOf = (b: SteelBuy) => (b.tons === null ? "tons?" : b.how === "part payment" ? "part payment, no tons" : tons(b.tons));
  // The tons installed on each floor, in the floors' order.
  const order = (area: string) => {
    const i = data?.areas.indexOf(area) ?? -1;
    return i < 0 ? 99 : i;
  };
  const byArea = tr
    ? Object.entries(tr.installs.reduce<Record<string, number>>((m, i) => ({ ...m, [i.area]: (m[i.area] ?? 0) + i.tons }), {})).sort((a, b) => order(a[0]) - order(b[0]))
    : [];
  const share = tr && tr.tons > 0 ? Math.min(100, Math.round((tr.installed / tr.tons) * 100)) : 0;

  return (
    <>
      <SiteHeader title="Steel" sub={tr ? `${tons(tr.installed)} installed of ${tons(tr.tons)} bought` : "Loading…"} onMenu={() => setMenuOpen(true)} />
      {signedOut && (
        <div className={styles.banner} role="alert">
          You&rsquo;ve been signed out. <a href="/todo/steel">Sign in again</a>
        </div>
      )}
      {offline && !signedOut && (
        <div className={styles.banner} role="status">
          No signal: showing the steel as it was. Logging needs a signal.
        </div>
      )}

      <main className={styles.main}>
        {!tr ? (
          <p className={styles.loading}>Loading the steel…</p>
        ) : (
          <>
            <div className={styles.addBar} style={{ gridTemplateColumns: "1fr" }}>
              <button type="button" className={styles.addPhoto} onClick={() => setSheet({ install: null })}>
                Log steel installed
              </button>
            </div>

            <section className={s.card} aria-label="What the steel benders are owed">
              {tr.installs.length === 0 ? (
                <>
                  <p className={s.big}>No tons logged yet</p>
                  <p className={s.line}>
                    Log the tons bent and installed so far: what the steel benders are owed comes from them. Paid to them so far: <b>{money(tr.paid)}</b>.
                  </p>
                </>
              ) : (
                <>
                  <p className={tr.owed >= 0 ? s.big : `${s.big} ${s.bigAhead}`}>{tr.owed >= 0 ? `${money(tr.owed)} owed` : `${money(-tr.owed)} paid ahead`}</p>
                  <p className={s.line}>
                    {tons(tr.installed)} installed × {cedis(tr.rate)} = <b>{money(tr.earned)}</b> earned, less <b>{money(tr.paid)}</b> paid to the steel benders.
                  </p>
                </>
              )}
              <div className={s.bar} aria-hidden="true">
                <span style={{ width: `${share}%` }} />
              </div>
              <p className={tr.stock < 0 ? s.warn : s.line}>
                {tr.stock >= 0
                  ? `${tons(tr.stock)} in stock: bought, not installed yet (${money(tr.toCome)} of labour still to come).`
                  : `${tons(-tr.stock)} more installed than the steel bought says: check the tons on the steel bought below.`}
              </p>
              {byArea.length > 0 && <p className={s.line}>By floor: {byArea.map(([area, n]) => `${area} ${tons(n)}`).join(" · ")}</p>}
              {tr.unknown > 0 && <p className={s.warn}>{tr.unknown === 1 ? "One steel buy has" : `${tr.unknown} steel buys have`} no tons yet: type them below.</p>}
              {editing === "rate" ? (
                <div className={s.edit}>
                  <label>
                    Labour a ton (GH₵)
                    <input className={styles.input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
                  </label>
                  <button type="button" className={s.save} onClick={() => void quick({ action: "rate", rate: Number(value.replace(/,/g, "")) }, "Rate saved")} disabled={busy}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditing(null)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className={s.buttons}>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing("rate");
                      setValue(String(tr.rate));
                    }}
                  >
                    Labour {cedis(tr.rate)} a ton: change
                  </button>
                </div>
              )}
            </section>

            <h2 className={styles.groupTitle}>
              Installed <span>{tons(tr.installed)}</span>
            </h2>
            {tr.installs.length === 0 ? (
              <p className={styles.empty}>Nothing logged yet. When a part is bent and installed, tap Log steel installed.</p>
            ) : (
              <ul className={s.list}>
                {tr.installs.map((i) => (
                  <li key={i.id}>
                    <button type="button" className={s.row} onClick={() => setSheet({ install: i })} aria-label={`${niceDate(i.date)}, ${i.area}, ${i.part}, ${tons(i.tons)}: change`}>
                      <span>
                        {niceDate(i.date)} · <b>{i.area}</b> · {i.part}
                        {i.note ? ` · ${i.note}` : ""}
                      </span>
                      <b className={s.tonsBig}>{tons(i.tons)}</b>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <h2 className={styles.groupTitle}>
              Bought <span>{tons(tr.tons)}</span>
            </h2>
            {tr.bought.length === 0 ? (
              <p className={styles.empty}>No steel in the expenses yet.</p>
            ) : (
              <ul className={s.list}>
                {newestFirst(tr.bought).map((b) => (
                  <li key={b.id}>
                    <span>
                      {niceDate(b.date)} · {b.supplier || "No supplier"} · {money(b.amount)}
                      {b.description ? ` · ${b.description}` : ""}
                    </span>
                    {editing === b.id ? (
                      <span className={s.edit}>
                        <input className={styles.input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Tons" disabled={busy} />
                        <button type="button" className={s.save} onClick={() => void quick({ action: "tons", id: b.id, tons: value.trim() === "" ? null : Number(value.replace(",", ".")) }, "Tons saved")} disabled={busy}>
                          Save
                        </button>
                        <button type="button" onClick={() => setEditing(null)} disabled={busy}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={b.tons === null ? s.tonsMissing : s.tons}
                        onClick={() => {
                          setEditing(b.id);
                          setValue(b.tons === null ? "" : String(b.tons));
                        }}
                      >
                        {tonsOf(b)} ✎
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h2 className={styles.groupTitle}>
              Paid to the steel benders <span>{money(tr.paid)}</span>
            </h2>
            {tr.labour.length === 0 ? (
              <p className={styles.empty}>No payments to the steel benders in the expenses yet.</p>
            ) : (
              <ul className={s.list}>
                {newestFirst(tr.labour).map((l) => (
                  <li key={l.id}>
                    <span>
                      {niceDate(l.date)} · {l.supplier || "No name"} · <b>{money(l.amount)}</b>
                      {l.description ? ` · ${l.description}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className={s.small}>
              The steel bought and the payments come from the expenses: steel under Materials, and Wonder or steel bending labour (never the bending machines&rsquo; hire).
            </p>
          </>
        )}
      </main>

      {sheet && data && (
        <InstallSheet
          install={sheet.install}
          areas={data.areas}
          onClose={() => setSheet(null)}
          onSave={async (body) => {
            await change({ action: "install", ...body }, sheet.install ? "Changes saved" : `${tons(Number(body.tons))} installed, logged`);
            setSheet(null);
          }}
          onDelete={async (id) => {
            await change({ action: "delete", id }, "Entry deleted");
            setSheet(null);
          }}
        />
      )}
      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
      {toast && (
        <div className={`${styles.toast} ${toast.tone === "error" ? styles.toastError : ""}`} role="status">
          <span>{toast.text}</span>
        </div>
      )}
    </>
  );
}

/* ---------- tons installed ---------- */

function InstallSheet({
  install,
  areas,
  onClose,
  onSave,
  onDelete,
}: {
  install: SteelInstall | null;
  areas: string[];
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [date, setDate] = useState(install?.date ?? todayGhana());
  const [area, setArea] = useState(install?.area ?? "");
  const [part, setPart] = useState(install?.part ?? "");
  const [amount, setAmount] = useState(install ? String(install.tons) : "");
  const [note, setNote] = useState(install?.note ?? "");
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // What was missing is put right: the message goes.
  const fix = (set: (value: string) => void) => (value: string) => {
    set(value);
    setError("");
  };

  // On success the page closes the sheet; on a failure it stays open with the reason.
  const run = async (work: () => Promise<void>) => {
    setSaving(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const save = () => {
    const n = Number(amount.replace(",", "."));
    if (!area) return setError("Pick the floor or area.");
    if (!part) return setError("Pick what was installed.");
    if (!(n > 0)) return setError("Type the tons installed, e.g. 4.5.");
    void run(() => onSave({ ...(install ? { id: install.id } : {}), date, area, part, tons: n, note: note.trim() }));
  };

  // An entry made on a floor since renamed still shows its own.
  const shownAreas = area && !areas.includes(area) ? [area, ...areas] : areas;
  const shownParts: readonly string[] = part && !(STEEL_PARTS as readonly string[]).includes(part) ? [part, ...STEEL_PARTS] : STEEL_PARTS;
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Steel installed">
        <h2 className={styles.sheetTitle}>{install ? "Steel installed: change" : "Steel installed"}</h2>
        <label className={styles.label} htmlFor="st-date">
          Installed on
        </label>
        <input id="st-date" className={styles.input} type="date" value={date} max={todayGhana()} onChange={(e) => e.target.value && setDate(e.target.value)} disabled={saving} />
        <span className={styles.label}>Floor or area</span>
        <div className={styles.chips}>
          {shownAreas.map((a) => (
            <button key={a} type="button" className={area === a ? styles.chipOn : styles.chip} aria-pressed={area === a} onClick={() => fix(setArea)(a)} disabled={saving}>
              {a}
            </button>
          ))}
        </div>
        <span className={styles.label}>What was installed</span>
        <div className={styles.chips}>
          {shownParts.map((p) => (
            <button key={p} type="button" className={part === p ? styles.chipOn : styles.chip} aria-pressed={part === p} onClick={() => fix(setPart)(p)} disabled={saving}>
              {p}
            </button>
          ))}
        </div>
        <label className={styles.label} htmlFor="st-tons">
          Tons installed
        </label>
        <input id="st-tons" className={styles.input} inputMode="decimal" value={amount} onChange={(e) => fix(setAmount)(e.target.value)} placeholder="e.g. 4.5" disabled={saving} />
        <label className={styles.label} htmlFor="st-note">
          Note (optional)
        </label>
        <input id="st-note" className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. columns C1 to C12" disabled={saving} />
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {install && (
          <button
            type="button"
            className={armed ? `${s.deleteBtn} ${styles.dangerArmed}` : s.deleteBtn}
            onClick={() => (armed ? void run(() => onDelete(install.id)) : setArmed(true))}
            disabled={saving}
          >
            {armed ? "Tap again to delete this entry" : "Delete this entry"}
          </button>
        )}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
