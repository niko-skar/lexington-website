"use client";

import { useState } from "react";

import { qtyWords, type ExpectedLine } from "@/lib/store/deliveries";
import type { StoreData, StoreItem } from "@/lib/store/shared";
import { storeMatches } from "@/lib/store/shopping";
import type { TodoMe } from "@/lib/todo/shared";
import { errorText, send } from "./api";
import d from "./Deliveries.module.css";
import { niceDate } from "./ExpenseForm";
import { PhotoField, UnitPicker } from "./StoreBits";
import styles from "./Todo.module.css";
import { useUploadSlot } from "./useUploadSlot";

// Deliveries at the store door (lib/store/deliveries.ts says what and why): what's expected (paid purchases into the
// store room, placed orders) ticked Arrived, or "Not all of it" with what came; and something nobody said was coming,
// checked in as a delivery.

/** On the stock tab: what's expected, or a way in for a delivery nobody said was coming. */
export function DeliveriesBar({ expected, onOpen }: { expected: ExpectedLine[]; onOpen: () => void }) {
  return expected.length ? (
    <button type="button" className={d.bar} onClick={onOpen}>
      <b>
        {expected.length} {expected.length === 1 ? "delivery" : "deliveries"} to tick when {expected.length === 1 ? "it comes" : "they come"} in
      </b>
      <span>{expected.slice(0, 3).map((l) => `${l.name} ${qtyWords(l.qty, l.unit)}`).join(" · ")}{expected.length > 3 ? " …" : ""}</span>
    </button>
  ) : (
    <button type="button" className={d.quiet} onClick={onOpen}>
      <b>A delivery came in?</b>
      <span>Check it in here, so it&rsquo;s counted once</span>
    </button>
  );
}

const whenWords = (l: ExpectedLine, today: string) =>
  l.kind === "expense"
    ? `Paid ${niceDate(l.date)}${l.ref ? ` · ${l.ref}` : ""}${l.supplier ? ` · ${l.supplier}` : ""}`
    : `Ordered ${l.date ? niceDate(l.date) : ""}${l.neededBy ? ` · needed ${l.neededBy < today ? "since" : "by"} ${niceDate(l.neededBy)}` : ""}${l.ref ? ` · ${l.ref}` : ""}${l.supplier ? ` · ${l.supplier}` : ""}`;

export function DeliveriesSheet({
  expected,
  today,
  onClose,
  onDone,
  onOther,
}: {
  expected: ExpectedLine[];
  today: string;
  onClose: () => void;
  /** Checked in: the store as it is now, and what to say. */
  onDone: (next: StoreData, text: string) => void;
  onOther: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [some, setSome] = useState<{ key: string; qty: string } | null>(null);
  const [error, setError] = useState("");

  const tick = async (l: ExpectedLine, qty: number) => {
    setBusy(l.key);
    setError("");
    try {
      const next = await send<StoreData>("/api/store/deliveries", "POST", {
        action: "arrived",
        kind: l.kind,
        id: l.id,
        ...(l.kind === "expense" ? { itemId: l.itemId } : { line: l.line }),
        qty,
      });
      setSome(null);
      onDone(next, qty < l.qty ? `${l.name}: ${qtyWords(qty, l.unit)} of ${qtyWords(l.qty, l.unit)} came` : `${l.name} arrived: ${qtyWords(qty, l.unit)}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Deliveries">
        <h2 className={styles.sheetTitle}>Deliveries</h2>
        <p className={styles.sheetNote}>
          Tick each one as it comes in. What was paid for is in the stock already: ticking it says it came (or how much did), so nothing is counted twice.
        </p>
        {expected.length === 0 ? (
          <p className={styles.sheetNote}>Nothing is expected right now.</p>
        ) : (
          <div className={d.list}>
            {expected.map((l) => (
              <div key={l.key} className={d.row} role="group" aria-label={l.name}>
                <div className={d.rowTop}>
                  <b>{l.name}</b>
                  <span className={d.qty}>{qtyWords(l.qty, l.unit)}</span>
                </div>
                <p className={`${d.sub} ${l.neededBy && l.neededBy < today ? d.late : ""}`}>{whenWords(l, today)}</p>
                {some?.key === l.key ? (
                  <div className={d.some}>
                    <input
                      className={styles.input}
                      inputMode="decimal"
                      value={some.qty}
                      onChange={(e) => setSome({ key: l.key, qty: e.target.value })}
                      aria-label={`How many ${l.name} came`}
                      placeholder="How many came"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const n = Number(some.qty.replace(/,/g, ""));
                        if (!(n >= 0) || some.qty.trim() === "") return setError("Type how many came (0 if none).");
                        void tick(l, n);
                      }}
                      disabled={busy === l.key}
                    >
                      {busy === l.key ? "Saving…" : "Save"}
                    </button>
                  </div>
                ) : (
                  <div className={d.buttons}>
                    <button type="button" className={d.arrived} onClick={() => void tick(l, l.qty)} disabled={busy === l.key}>
                      {busy === l.key ? "Saving…" : "Arrived"}
                    </button>
                    <button type="button" onClick={() => setSome({ key: l.key, qty: "" })} disabled={!!busy}>
                      Not all of it
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        <button type="button" className={d.other} onClick={onOther} disabled={!!busy}>
          + Something else came in
        </button>
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={!!busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** A delivery nobody said was coming: what (a store item, or something new), how many, a photo of it or its note. */
export function WalkInSheet({
  me,
  items,
  onClose,
  onDone,
}: {
  me: TodoMe;
  items: StoreItem[];
  onClose: () => void;
  onDone: (next: StoreData, text: string) => void;
}) {
  const [name, setName] = useState("");
  const [item, setItem] = useState<StoreItem | null>(null);
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot("/api/store/photo");
  const matches = item ? [] : storeMatches(name, items.filter((i) => i.stocked), [], 4).flatMap((m) => (m.kind === "item" ? [m.item] : []));
  const exact = item ? null : (items.find((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null);

  const save = async () => {
    const chosen = item ?? exact;
    if (!chosen && !name.trim()) return setError("Say what came, e.g. Cement 50kg.");
    const n = Number(qty.replace(/,/g, ""));
    if (!(n > 0)) return setError("Type how many came.");
    setSaving(true);
    setError("");
    let photoId: string | undefined;
    if (slot) {
      const photo = await settled();
      if (!photo) {
        setSaving(false);
        return setError("The photo didn't upload. Take it again, or remove it.");
      }
      photoId = photo.id;
    }
    try {
      const next = await send<StoreData>("/api/store/deliveries", "POST", {
        action: "walkin",
        ...(chosen ? { itemId: chosen.id } : { name: name.trim(), unit }),
        qty: n,
        note: note.trim(),
        ...(photoId ? { photoId } : {}),
      });
      clear(true);
      onDone(next, `Checked in: ${qtyWords(n, chosen?.unit ?? unit)} ${chosen?.name ?? name.trim()}${me.kind === "admin" ? "" : ". The office ties it to the payment."}`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Something came in">
        <h2 className={styles.sheetTitle}>Something came in</h2>
        <p className={styles.sheetNote}>It&rsquo;s in the stock from now. When the office logs the payment, the app ties it to this, so it isn&rsquo;t counted twice.</p>
        <span className={styles.label}>What came</span>
        {item ? (
          <div className={d.picked}>
            <b>{item.name}</b>
            <button type="button" onClick={() => setItem(null)} disabled={saving}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Cement 50kg"
              aria-label="What came"
              autoFocus
              disabled={saving}
            />
            {matches.length > 0 && (
              <div className={styles.chips}>
                {matches.map((m) => (
                  <button key={m.id} type="button" className={styles.chip} onClick={() => setItem(m)} disabled={saving}>
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <label className={styles.label} htmlFor="walkin-qty">
          How many{item || exact ? ` (${(item ?? exact)!.unit})` : ""}
        </label>
        <input id="walkin-qty" className={styles.input} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 20" disabled={saving} />
        {!item && !exact && name.trim() && (
          <>
            <span className={styles.label}>New in the store: counted in</span>
            <UnitPicker id="walkin-unit" value={unit} onChange={setUnit} />
          </>
        )}
        <PhotoField idBase="walkin" slot={slot} onPick={start} onClear={() => clear()} label="Photo of it or its delivery note (optional)" />
        <label className={styles.label} htmlFor="walkin-note">
          Note (optional)
        </label>
        <input id="walkin-note" className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. From Kalushia, on their truck" disabled={saving} />
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
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
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Check it in"}
          </button>
        </div>
      </div>
    </div>
  );
}
