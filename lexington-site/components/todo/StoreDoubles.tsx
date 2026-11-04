"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

import type { StoreDouble } from "@/lib/store/doubles";
import { MAX_TOOL_COUNT, qtyUnit, type StoreEntry, type StoreItem, type StoreTool } from "@/lib/store/shared";
import { photoAt } from "@/lib/todo/shared";
import { errorText, send } from "./api";
import site from "./Site.module.css";
import { CameraIcon } from "./StoreBits";
import styles from "./Todo.module.css";

// Doubles in the store room (Niko, 4 Nov 2026: "add a duplicate check so these nimrods don't double add things, have
// it check the photo too and mark if it's similar for me as well"; lib/store/doubles.ts). Adding something that looks
// like something already on the list asks "Is it on the list already?" first; on "To check" the office sees what each
// new thing might be a double of, and can put the two together.

export type ListEntry = { type: "item"; item: StoreItem } | { type: "tool"; tool: StoreTool };

export const entryId = (e: ListEntry) => (e.type === "item" ? e.item.id : e.tool.id);
export const entryName = (e: ListEntry) => (e.type === "item" ? e.item.name : e.tool.name);
const entryPhoto = (e: ListEntry) => (e.type === "item" ? e.item.photoUrl : e.tool.photoUrl);
export const entryDetail = (e: ListEntry) =>
  e.type === "item" ? `${qtyUnit(e.item.level, e.item.unit)} · material${e.item.category ? ` · ${e.item.category}` : ""}` : `${e.tool.count} · tool`;

/** A double as it is on the list now; null when it's gone off it (deleted, put together, a tool not used any more). */
export function findEntry(d: Pick<StoreDouble, "kind" | "id">, items: readonly StoreItem[], tools: readonly StoreTool[]): ListEntry | null {
  if (d.kind === "item") {
    const item = items.find((i) => i.id === d.id);
    return item ? { type: "item", item } : null;
  }
  const tool = tools.find((t) => t.id === d.id && !t.retired);
  return tool ? { type: "tool", tool } : null;
}

function Thumb({ photo }: { photo: string | null }) {
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store (or the phone's own)
    <img className={site.itemThumb} src={photoAt(photo, 120)} alt="" loading="lazy" />
  ) : (
    <span className={site.itemThumbEmpty} aria-hidden="true">
      <CameraIcon />
    </span>
  );
}

/** Its photo, its name, and how many of it there are. */
export function EntryTop({ entry, children }: { entry: ListEntry; children?: ReactNode }) {
  return (
    <div className={site.checkTop}>
      <Thumb photo={entryPhoto(entry)} />
      <span className={site.itemName}>
        {entryName(entry)}
        <small>{entryDetail(entry)}</small>
        {children}
      </span>
    </div>
  );
}

const LOOK_WAIT_MS = 45_000;

/**
 * The look for a new item or tool (POST /api/store/doubles), by its name and photo. Asked early (the photo in, the name
 * typed), so the answer is usually there by "Add"; asked again with the same, it's the same answer. Null: it couldn't
 * look (no signal, an error, too slow): then it's added without, and the office's look does it later.
 */
export function useDoubleCheck(kind: "item" | "tool") {
  const last = useRef<{ key: string; answer: Promise<StoreDouble[] | null> } | null>(null);
  return useCallback(
    (name: string, photoId: string | null) => {
      const clean = name.replace(/\s+/g, " ").trim();
      const key = JSON.stringify([clean.toLowerCase(), photoId]);
      if (last.current?.key === key) return last.current.answer;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const answer = Promise.race([
        send<{ doubles: StoreDouble[] }>("/api/store/doubles", "POST", { kind, name: clean, photoId }).then((r) => r.doubles),
        new Promise<null>((r) => (timer = setTimeout(() => r(null), LOOK_WAIT_MS))),
      ])
        .catch(() => null)
        .finally(() => clearTimeout(timer));
      last.current = { key, answer };
      // A failed look isn't kept: asked again, it looks again.
      void answer.then((d) => {
        if (d === null && last.current?.key === key) last.current = null;
      });
      return answer;
    },
    [kind]
  );
}

/** What "Yes, it's this one" did (lib/store/merge.ts sameThing). */
export type SameAnswer = {
  item?: StoreItem;
  tool?: StoreTool;
  entry?: StoreEntry;
  counted: "recorded" | "office" | "set" | "same" | "none";
  photoUsed: boolean;
};

/** "Is it on the list already?": what's being added, the look-alikes, and the two answers. */
export function DoubleAsk({
  adding,
  doubles,
  items,
  tools,
  busy,
  error,
  onSame,
  onNew,
  onBack,
}: {
  adding: { name: string; detail: string; photo: string | null };
  doubles: readonly StoreDouble[];
  items: readonly StoreItem[];
  tools: readonly StoreTool[];
  /** "new" while adding it; a look-alike's id while saving "it's this one". */
  busy: string | null;
  error: string;
  onSame: (d: StoreDouble) => void;
  onNew: () => void;
  onBack: () => void;
}) {
  const shown = doubles.flatMap((d) => {
    const entry = findEntry(d, items, tools);
    return entry ? [{ d, entry }] : [];
  });
  return (
    <>
      <h2 className={styles.sheetTitle}>Is it on the list already?</h2>
      <div className={site.checkTop}>
        <Thumb photo={adding.photo} />
        <span className={site.itemName}>
          {adding.name}
          <small>{adding.detail}</small>
          <small>What you&rsquo;re adding</small>
        </span>
      </div>
      <p className={styles.sheetNote}>
        {shown.length === 1 ? "It looks like this one, already on the list. Is it the same thing?" : "It looks like one of these, already on the list. Is it one of them?"}
      </p>
      <div className={site.doubleList}>
        {shown.map(({ d, entry }) => (
          <div key={d.id} className={site.doubleCard}>
            <EntryTop entry={entry} />
            {d.why && <p className={site.doubleWhy}>{d.why}</p>}
            <button type="button" className={site.doubleYes} onClick={() => onSame(d)} disabled={!!busy}>
              {busy === d.id ? "Saving…" : "Yes, it's this one"}
            </button>
          </div>
        ))}
      </div>
      {error && <p className={styles.sheetError}>{error}</p>}
      <div className={styles.sheetButtons}>
        <button type="button" className={styles.sheetCancel} onClick={onBack} disabled={!!busy}>
          Back
        </button>
        <button type="button" className={styles.sheetSave} onClick={onNew} disabled={!!busy}>
          {busy === "new" ? "Saving…" : "No, it's new: add it"}
        </button>
      </div>
    </>
  );
}

/** What "Yes, it's this one" says on the screen afterwards. */
export function sameWords(answer: SameAnswer, adding: "item" | "tool", count: number): string {
  if (answer.item) {
    if (answer.counted === "recorded") return `Counted on ${answer.item.name}: ${qtyUnit(answer.item.level, answer.item.unit)}`;
    return adding === "item" ? `It's in the store already: ${answer.item.name}. Count it there.` : `It's on the list as a material: ${answer.item.name}`;
  }
  const tool = answer.tool!;
  if (adding === "item") return `It's on the tool list: ${tool.name}`;
  if (answer.counted === "office") return `It's on the list already: ${tool.name}. The office will see you counted ${count}.`;
  if (answer.counted === "set") return `${tool.name}: ${tool.count}`;
  return `It's on the list already: ${tool.name}`;
}

/** The office: one entry goes into the other (its take-outs, counts and purchases with it), and how many in all. */
export function TogetherSheet({ from, into, onClose, onDone }: { from: ListEntry; into: ListEntry; onClose: () => void; onDone: (kept: ListEntry) => void }) {
  const fromName = entryName(from);
  const intoName = entryName(into);
  const sameUnit = from.type === "item" && into.type === "item" ? from.item.unit.toLowerCase() === into.item.unit.toLowerCase() : true;
  const together =
    from.type === "item" && into.type === "item"
      ? sameUnit
        ? Math.round((from.item.level + into.item.level) * 1000) / 1000
        : null
      : from.type === "tool" && into.type === "tool"
        ? from.tool.count + into.tool.count
        : null;
  const [name, setName] = useState<"into" | "from">("into");
  const [count, setCount] = useState(together === null ? "" : String(together));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const unit = into.type === "item" ? into.item.unit : "";

  const save = async () => {
    setError("");
    const n = Number(count);
    if (count.trim() === "" || !(n >= 0) || (into.type === "tool" && (!Number.isInteger(n) || n > MAX_TOOL_COUNT))) {
      return setError(into.type === "tool" ? "Type how many we have in all (0 if none)." : "Type how many there are in all (0 if none).");
    }
    setSaving(true);
    try {
      const answer = await send<{ item?: StoreItem; tool?: StoreTool }>("/api/store/doubles/together", "POST", {
        from: { kind: from.type, id: entryId(from) },
        into: { kind: into.type, id: entryId(into) },
        name,
        count: n,
      });
      onDone(answer.item ? { type: "item", item: answer.item } : { type: "tool", tool: answer.tool! });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Put them together">
        <h2 className={styles.sheetTitle}>Put them together</h2>
        <div className={site.doubleList}>
          <EntryTop entry={from} />
          <EntryTop entry={into}>
            <small>Goes into this one</small>
          </EntryTop>
        </div>
        <p className={styles.sheetNote}>
          Everything recorded on &ldquo;{fromName}&rdquo; moves onto the other one, and it comes off the list.
          {from.type === "item" ? " Its purchases stay in the expenses as they are." : ""}
        </p>
        <span className={styles.label}>Name to keep</span>
        <div className={styles.chips} role="group" aria-label="Name to keep">
          {(["into", "from"] as const).map((k) => (
            <button key={k} type="button" className={name === k ? styles.chipOn : styles.chip} aria-pressed={name === k} onClick={() => setName(k)}>
              {k === "into" ? intoName : fromName}
            </button>
          ))}
        </div>
        <label className={styles.label} htmlFor="together-count">
          {into.type === "tool" ? "How many do we have in all?" : `How many are there in all now? (in ${unit})`}
        </label>
        <input
          id="together-count"
          className={`${styles.input} ${site.countInput}`}
          type="number"
          inputMode={into.type === "tool" ? "numeric" : "decimal"}
          min="0"
          step={into.type === "tool" ? "1" : "any"}
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
        <p className={styles.sheetNote}>
          {together === null
            ? `They're counted in different units: type how many there are in ${unit}.`
            : `The two say ${into.type === "tool" ? together : qtyUnit(together, unit)} together. If it's the same ${into.type === "tool" ? "tools" : "stock"} counted twice, type what's really there.`}
        </p>
        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Put together"}
          </button>
        </div>
      </div>
    </div>
  );
}
