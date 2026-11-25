"use client";

import { useRef, useState } from "react";

import type { ConcreteData, PourChecklist } from "@/lib/concrete/shared";
import { errorText, send } from "./api";
import ps from "./Pours.module.css";
import styles from "./Todo.module.css";

// The pour checklists on the concrete page (Niko, 25 Nov 2026: "put this into the concrete section and out of
// payroll"). They were edited under the roll call's Workers; they're the same records (lib/concrete/pours.ts
// saveChecklist), so a pour booked here or started on the roll call gets the same list. Book a pour starts it with a
// copy of one: a change here is for pours booked after it, pours already booked keep their own list.

export function PourChecklists({
  lists,
  canEdit,
  onData,
  onToast,
}: {
  lists: PourChecklist[];
  canEdit: boolean;
  onData: (data: ConcreteData) => void;
  onToast: (text: string, error?: boolean) => void;
}) {
  const [editing, setEditing] = useState<PourChecklist | "new" | null>(null);
  return (
    <section className={styles.group} id="checklists" aria-label="Pour checklists">
      <h2 className={styles.groupTitle}>Pour checklists</h2>
      <div className={ps.lists}>
        {!lists.length && <p className={ps.line}>No checklists yet. Make one for each kind of pour.</p>}
        {lists.map((l) => (
          <div key={l.id} className={ps.listRow}>
            <div>
              <b>{l.name}</b>
              <span>{l.checks.length === 1 ? "1 check" : `${l.checks.length} checks`}</span>
            </div>
            {canEdit && (
              <button type="button" onClick={() => setEditing(l)} aria-label={`Edit ${l.name}`}>
                Edit
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <button type="button" className={ps.link} onClick={() => setEditing("new")}>
          + New checklist
        </button>
      )}
      <p className={ps.hint}>
        Book a pour starts it with one of these, and the concrete cubes check is added to every pour. A change here is for pours booked after it: pours already
        booked keep their own list.
      </p>
      {editing && (
        <ChecklistSheet
          list={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(data, text) => {
            onData(data);
            setEditing(null);
            onToast(text);
          }}
        />
      )}
    </section>
  );
}

type Row = { key: string; text: string; old: boolean };

function ChecklistSheet({ list, onClose, onSaved }: { list: PourChecklist | null; onClose: () => void; onSaved: (data: ConcreteData, text: string) => void }) {
  const [name, setName] = useState(list?.name ?? "");
  const [rows, setRows] = useState<Row[]>(() => (list?.checks ?? []).map((c) => ({ key: c.key, text: c.text, old: true })));
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  const counter = useRef(0);

  const put = (key: string, text: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, text } : x)));
  const up = (i: number) =>
    setRows((r) => {
      if (i <= 0) return r;
      const next = [...r];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  const drop = (key: string) => setRows((r) => r.filter((x) => x.key !== key));
  const add = () => {
    const text = adding.trim();
    if (!text) return setError("Type the check first, then tap Add.");
    setError("");
    setRows((r) => [...r, { key: `new${++counter.current}`, text, old: false }]);
    setAdding("");
  };

  const run = async (body: Record<string, unknown>, text: string) => {
    setSaving(true);
    setError("");
    try {
      onSaved(await send<ConcreteData>("/api/concrete/pours", "POST", body), text);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
      setArmed(false);
    }
  };
  const save = () => {
    const checks = [...rows.map((r) => ({ key: r.old ? r.key : undefined, text: r.text.trim() })), ...(adding.trim() ? [{ key: undefined, text: adding.trim() }] : [])].filter((c) => c.text);
    if (!name.trim()) return setError("Give the checklist a name, e.g. Stairs.");
    if (!checks.length) return setError("Add at least one check.");
    void run({ action: "checklist", ...(list ? { id: list.id } : {}), name: name.trim(), checks }, `Checklist saved: ${name.trim()}`);
  };
  const remove = () => {
    if (!list) return;
    if (!armed) return setArmed(true);
    void run({ action: "checklistDelete", id: list.id }, `Checklist deleted: ${list.name}`);
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={list ? `Checklist: ${list.name}` : "New checklist"}>
        <h2 className={styles.sheetTitle}>{list ? "Change the checklist" : "New checklist"}</h2>
        <label className={styles.label} htmlFor="cl-name">
          Name of the checklist
        </label>
        <input id="cl-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Stairs" disabled={saving} />
        <span className={styles.label}>Checks, in order</span>
        <ol className={ps.clRows}>
          {rows.map((r, i) => (
            <li key={r.key} className={ps.clRow}>
              <textarea className={styles.textarea} rows={2} value={r.text} onChange={(e) => put(r.key, e.target.value)} maxLength={300} aria-label={`Check ${i + 1}`} disabled={saving} />
              <button type="button" onClick={() => up(i)} disabled={saving || i === 0} aria-label="Move up">
                ↑
              </button>
              <button type="button" onClick={() => drop(r.key)} disabled={saving} aria-label="Take this check out">
                ✕
              </button>
            </li>
          ))}
        </ol>
        <div className={ps.clAdd}>
          <input
            className={styles.input}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            maxLength={300}
            placeholder="Add a check"
            aria-label="Add a check"
            disabled={saving}
          />
          <button type="button" onClick={add} disabled={saving}>
            Add
          </button>
        </div>
        <p className={styles.sheetNote}>For pours booked from now on. Pours already booked keep the list they started with.</p>
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        {list && (
          <button type="button" className={armed ? `${ps.delete} ${styles.dangerArmed}` : ps.delete} onClick={remove} disabled={saving}>
            {armed ? "Tap again to delete this checklist" : "Delete this checklist"}
          </button>
        )}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save checklist"}
          </button>
        </div>
      </div>
    </div>
  );
}
