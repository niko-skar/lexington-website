"use client";

import { useMemo, useState } from "react";

import { atReorderPoint, qtyUnit, type StoreItem, type StoreTool } from "@/lib/store/shared";
import {
  BUY_GROUPS,
  buyQty,
  byGroup,
  guessBuyGroup,
  lineName,
  lineQty,
  lineStock,
  MAX_BUY_NAME,
  MAX_BUY_NOTE,
  onListAlready,
  storeMatches,
  type BuyGroup,
  type BuyLine,
  type GotLine,
  type StoreBuy,
} from "@/lib/store/shopping";
import { categoryOf } from "@/lib/store/categories";
import { photoAt, type TodoMe } from "@/lib/todo/shared";
import { dayName, errorText, send } from "./api";
import site from "./Site.module.css";
import { PhotoField, time, UnitPicker } from "./StoreBits";
import styles from "./Todo.module.css";
import { useUploadSlot } from "./useUploadSlot";

// The store room's shopping list (lib/store/shopping.ts): what's to buy, ticked off at the hardware store, and what was
// got lately. Anyone using the store adds to it; the store's items at their reorder point come onto it by themselves.

/** "10:32", "yesterday 10:32", "Mon 3 Nov". */
export function ago(iso: string) {
  const day = dayName(iso);
  if (day === "Today") return time(iso);
  if (day === "Yesterday") return `yesterday ${time(iso)}`;
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** The photo a line shows: its own, else the store item's or the tool's. */
const linePhoto = (line: BuyLine | GotLine) => (line.kind === "reorder" ? line.item.photoUrl : (line.buy.photoUrl ?? line.item?.photoUrl ?? line.tool?.photoUrl ?? null));

/** The small line under a line's name, to buy. */
function lineWords(line: BuyLine): string {
  if (line.kind === "reorder") {
    const i = line.item;
    return `${lineStock(line)} · reorder at ${qtyUnit(i.low ?? 0, i.unit)}`;
  }
  const b = line.buy;
  return [
    b.note ? `“${b.note}”` : "",
    lineStock(line) ? `store: ${lineStock(line).toLowerCase()}` : "",
    line.tool ? `tool: ${line.tool.count} in all` : "",
    `${b.by || "Someone"}, ${ago(b.at)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const TickIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/* ---------- the tab ---------- */

export function ShoppingTab({
  me,
  lines,
  got,
  dismissed,
  busy,
  onAdd,
  onCopy,
  onOpen,
  onGot,
  onBack,
  onOpenItem,
  onUndismiss,
}: {
  me: TodoMe;
  lines: BuyLine[];
  got: GotLine[];
  /** Store items at their reorder point the office said no need to reorder. */
  dismissed: StoreItem[];
  /** The line being ticked or put back just now. */
  busy: string | null;
  onAdd: () => void;
  onCopy: () => void;
  onOpen: (key: string) => void;
  onGot: (line: BuyLine) => void;
  onBack: (line: GotLine) => void;
  onOpenItem: (id: string) => void;
  onUndismiss: (item: StoreItem) => void;
}) {
  const isAdmin = me.kind === "admin";
  const [allGot, setAllGot] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const today = lines.filter((l) => l.kind === "buy" && l.buy.urgent).length;
  const gotShown = allGot ? got : got.slice(0, 8);

  return (
    <>
      <div className={site.buyBar}>
        <button type="button" className={site.newButton} onClick={onAdd}>
          + Add to the list
        </button>
        {lines.length > 0 && (
          <button type="button" className={site.buyCopy} onClick={onCopy}>
            Copy for WhatsApp
          </button>
        )}
      </div>
      {lines.length === 0 ? (
        <p className={styles.empty}>
          Nothing to buy. Tap + Add to the list for anything that&rsquo;s needed, from the store or not. Store items also come here by themselves when they&rsquo;re
          down to their reorder point{isAdmin ? " (tap an item, then Change, to set one)" : ""}.
        </p>
      ) : (
        <>
          <p className={site.buySummary}>
            {lines.length} to buy{today ? ` · ${today} needed today` : ""} · tick each one as you get it
          </p>
          {byGroup(lines).map(([group, list]) => (
            <section key={group} className={site.catGroup} aria-label={group}>
              <h2 className={styles.groupTitle}>
                {group} <span>{list.length}</span>
              </h2>
              <div className={site.buyList}>
                {list.map((line) => {
                  const photo = linePhoto(line);
                  const qty = lineQty(line);
                  const urgent = line.kind === "buy" && line.buy.urgent;
                  const out = !!line.item && line.item.stocked && line.item.level <= 0;
                  return (
                    <div key={line.key} className={`${site.buyRow} ${busy === line.key ? site.buyRowBusy : ""}`}>
                      <button type="button" className={site.buyTick} onClick={() => onGot(line)} disabled={busy === line.key} aria-label={`Got ${lineName(line)}`} />
                      <button type="button" className={site.buyMain} onClick={() => onOpen(line.key)}>
                        <span className={site.buyText}>
                          <span className={site.buyName}>
                            {urgent && <span className={site.buyToday}>Needed today</span>}
                            {lineName(line)}
                          </span>
                          <small className={out ? site.flagBad : undefined}>{lineWords(line)}</small>
                        </span>
                        {photo && (
                          // eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store
                          <img className={site.buyThumb} src={photoAt(photo, 120)} alt="" loading="lazy" />
                        )}
                        <span className={qty ? site.buyQty : site.buyQtyNone}>{qty || "how many?"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {got.length > 0 && (
        <section className={site.catGroup} aria-label="Got">
          <h2 className={styles.groupTitle}>
            Got <span>{got.length}</span>
          </h2>
          <div className={site.buyList}>
            {gotShown.map((line) => (
              <div key={`got-${line.key}`} className={`${site.buyRow} ${site.buyRowGot} ${busy === line.key ? site.buyRowBusy : ""}`}>
                <button type="button" className={site.buyTickOn} onClick={() => onBack(line)} disabled={busy === line.key} aria-label={`Put ${lineName(line)} back on the list`}>
                  <TickIcon />
                </button>
                <button type="button" className={site.buyMain} onClick={() => onOpen(line.key)}>
                  <span className={site.buyText}>
                    <span className={site.buyName}>{lineName(line)}</span>
                    <small>
                      {line.by ? `${line.by}, ` : ""}
                      {ago(line.at)}
                      {line.kind === "reorder" ? " · in the store once the payment is logged" : ""}
                    </small>
                  </span>
                  <span className={site.buyQtyGot}>{lineQty(line)}</span>
                </button>
              </div>
            ))}
          </div>
          {got.length > gotShown.length && (
            <button type="button" className={styles.linkButton} onClick={() => setAllGot(true)}>
              Show all {got.length} got in the last two weeks
            </button>
          )}
        </section>
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
                  <button type="button" className={site.reorderName} onClick={() => onOpenItem(item.id)}>
                    {item.name}
                  </button>
                  <span className={site.levelLow}>{qtyUnit(item.level, item.unit)}</span>
                </div>
                <p className={site.reorderLine}>Comes back by itself once it&rsquo;s restocked and runs low again.</p>
                {isAdmin && (
                  <div className={site.reorderButtons}>
                    <button type="button" onClick={() => onUndismiss(item)}>
                      Put back on the list
                    </button>
                  </div>
                )}
              </article>
            ))}
        </section>
      )}
    </>
  );
}

/* ---------- one line: what it is, and what to do with it ---------- */

export function BuySheet({
  me,
  line,
  busy,
  onClose,
  onGot,
  onBack,
  onChange,
  onDeleted,
  onDismiss,
  onEditItem,
  onOpenItem,
  onOpenTool,
  onOpenPhoto,
}: {
  me: TodoMe;
  line: BuyLine | GotLine;
  busy: boolean;
  onClose: () => void;
  onGot: () => void;
  onBack: () => void;
  /** Change what was added (the office; whoever added it, while it's to buy). */
  onChange: () => void;
  onDeleted: (id: string) => void;
  /** The office: no need to reorder a store item this time. */
  onDismiss: (item: StoreItem) => void;
  /** The office: a store item's reorder point and quantity. */
  onEditItem: (id: string) => void;
  onOpenItem: (id: string) => void;
  onOpenTool: (id: string) => void;
  onOpenPhoto: (url: string) => void;
}) {
  const isAdmin = me.kind === "admin";
  const [armed, setArmed] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const isGot = "at" in line;
  const buy = line.kind === "buy" ? line.buy : null;
  const item = line.item;
  const tool = line.kind === "buy" ? line.tool : null;
  const photo = linePhoto(line);
  const qty = lineQty(line);
  const canChange = !!buy && (isAdmin || (buy.mine && !buy.gotAt));

  const remove = async () => {
    if (!buy) return;
    setRemoving(true);
    setError("");
    try {
      await send(`/api/store/buys/${buy.id}`, "DELETE");
      onDeleted(buy.id);
    } catch (e) {
      setError(errorText(e));
      setRemoving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={lineName(line)}>
        <div className={site.itemHead}>
          <h2 className={styles.sheetTitle}>{lineName(line)}</h2>
          {canChange && (
            <button type="button" className={styles.linkButton} onClick={onChange}>
              Change
            </button>
          )}
        </div>
        {buy?.urgent && !isGot && <span className={site.buyToday}>Needed today</span>}
        <div className={site.itemPhotoRow}>
          {photo && (
            <button type="button" className={site.itemPhoto} onClick={() => onOpenPhoto(photo)} aria-label="Open the photo">
              {/* eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store */}
              <img src={photoAt(photo, 240)} alt="" />
            </button>
          )}
          <div>
            <p className={site.bigLevel}>{qty || <small>How many: not said</small>}</p>
            {buy?.note && <p className={site.buyNote}>&ldquo;{buy.note}&rdquo;</p>}
          </div>
        </div>
        <p className={styles.sheetNote}>
          {line.kind === "reorder"
            ? `${lineStock(line)} in the store: it reorders at ${qtyUnit(line.item.low ?? 0, line.item.unit)}.${line.item.reorderQty ? "" : " How much to order isn't set."}`
            : [
                `Added by ${buy!.by || "someone"}, ${ago(buy!.at)}.`,
                item ? `In the store: ${lineStock(line).toLowerCase() || "not kept there"}${atReorderPoint(item) ? " (down to its reorder point)" : ""}.` : "",
                tool ? `On the tool list: ${tool.count} in all.` : "",
              ]
                .filter(Boolean)
                .join(" ")}
        </p>
        {isGot && (
          <p className={site.gapGood}>
            Got by {line.by || "someone"}, {ago(line.at)}.{item && item.stocked ? " The store's count goes up when its payment is logged into the store." : ""}
          </p>
        )}

        {isGot ? (
          <button type="button" className={site.bigActionQuiet} onClick={onBack} disabled={busy}>
            {busy ? "Saving…" : "Not got after all: back on the list"}
          </button>
        ) : (
          <button type="button" className={site.bigAction} onClick={onGot} disabled={busy}>
            {busy ? "Saving…" : "Got it"}
          </button>
        )}

        <div className={site.actionRow}>
          {item && (
            <button type="button" onClick={() => onOpenItem(item.id)}>
              Open in the store
            </button>
          )}
          {tool && (
            <button type="button" onClick={() => onOpenTool(tool.id)}>
              Open the tool
            </button>
          )}
          {line.kind === "reorder" && isAdmin && !isGot && (
            <>
              <button type="button" onClick={() => onEditItem(line.item.id)}>
                Change the reorder point
              </button>
              <button type="button" onClick={() => onDismiss(line.item)}>
                No need to reorder
              </button>
            </>
          )}
        </div>

        {buy && (isAdmin || (buy.mine && !buy.gotAt)) && (
          <button type="button" className={armed ? `${site.deleteItem} ${styles.dangerArmed}` : site.deleteItem} onClick={() => (armed ? void remove() : setArmed(true))} disabled={removing}>
            {armed ? "Tap again: take it off the list" : "Take it off the list"}
          </button>
        )}
        {error && <p className={styles.sheetError}>{error}</p>}
        <button type="button" className={styles.sheetCancel} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ---------- adding something, or changing it ---------- */

/** The list's headings as chips (for something added, which goes under one). */
function GroupChips({ value, onChange }: { value: BuyGroup; onChange: (g: BuyGroup) => void }) {
  return (
    <div className={styles.chips} role="group" aria-label="Goes under">
      {BUY_GROUPS.map((g) => (
        <button key={g} type="button" className={value === g ? styles.chipOn : styles.chip} aria-pressed={value === g} onClick={() => onChange(g)}>
          {g}
        </button>
      ))}
    </div>
  );
}

export function AddBuySheet({
  me,
  items,
  tools,
  lines,
  editing,
  firstItem,
  firstTool,
  onClose,
  onSaved,
  onOpenLine,
}: {
  me: TodoMe;
  items: StoreItem[];
  tools: StoreTool[];
  /** What's to buy now (to say when it's on the list already). */
  lines: BuyLine[];
  /** Changing something already on the list. */
  editing?: StoreBuy;
  /** More of this store item, or this tool (added from its own page). */
  firstItem?: StoreItem;
  firstTool?: StoreTool;
  onClose: () => void;
  onSaved: (buy: StoreBuy) => void;
  /** "Change that one": the line that's on the list already. */
  onOpenLine: (key: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? firstItem?.name ?? firstTool?.name ?? "");
  const [link, setLink] = useState<{ kind: "item"; item: StoreItem } | { kind: "tool"; tool: StoreTool } | null>(
    firstItem ? { kind: "item", item: firstItem } : firstTool ? { kind: "tool", tool: firstTool } : null
  );
  const [qty, setQty] = useState(editing?.qty !== null && editing?.qty !== undefined ? String(editing.qty) : firstItem?.reorderQty ? String(firstItem.reorderQty) : "");
  const [unit, setUnit] = useState(editing ? editing.unit : firstItem ? firstItem.unit : firstTool ? "pcs" : "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [urgent, setUrgent] = useState(editing?.urgent ?? false);
  const [picked, setPicked] = useState<BuyGroup | null>(editing?.category ?? null);
  const [showGroups, setShowGroups] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { slot, start, clear, settled } = useUploadSlot("/api/store/photo");

  const linkedItem = editing ? (items.find((i) => i.id === editing.itemId) ?? null) : link?.kind === "item" ? link.item : null;
  const linkedTool = editing ? (tools.find((t) => t.id === editing.toolId) ?? null) : link?.kind === "tool" ? link.tool : null;
  const group: BuyGroup = picked ?? (linkedItem ? categoryOf(linkedItem) : linkedTool ? "Tools" : guessBuyGroup(name));
  const matches = useMemo(() => (editing || link ? [] : storeMatches(name, items, tools)), [editing, link, name, items, tools]);
  // On the list already: the same item or tool (one line each), or a name like it.
  const there = useMemo(() => {
    const others = editing ? lines.filter((l) => l.key !== editing.id) : lines;
    return onListAlready(name, linkedItem?.id ?? null, linkedTool?.id ?? null, others);
  }, [editing, lines, name, linkedItem, linkedTool]);
  const sameThing = !!there && there.kind === "buy" && ((!!linkedItem && there.buy.itemId === linkedItem.id) || (!!linkedTool && there.buy.toolId === linkedTool.id));

  const save = async () => {
    setError("");
    if (!name.trim()) return setError("Type what's needed, e.g. Cement 50kg.");
    if (qty.trim() !== "" && !(Number(qty) > 0)) return setError("Type how many as a number, or leave it empty.");
    setSaving(true);
    try {
      const photo = slot ? await settled() : null;
      if (slot && !photo) throw new Error("The photo didn't upload. Take it again, or remove it.");
      const body = {
        name: name.trim(),
        qty: qty.trim() === "" ? null : Number(qty),
        unit: qty.trim() === "" ? "" : unit.trim(),
        note: note.trim(),
        category: group,
        urgent,
        ...(photo ? { photoId: photo.id } : {}),
      };
      const { buy } = editing
        ? await send<{ buy: StoreBuy }>(`/api/store/buys/${editing.id}`, "PATCH", body)
        : await send<{ buy: StoreBuy }>("/api/store/buys", "POST", {
            ...body,
            ...(link?.kind === "item" ? { itemId: link.item.id } : link?.kind === "tool" ? { toolId: link.tool.id } : {}),
          });
      clear(true);
      onSaved(buy);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={editing ? `Change ${editing.name}` : "Add to the shopping list"}>
        <h2 className={styles.sheetTitle}>{editing ? `Change ${editing.name}` : "Add to the shopping list"}</h2>
        <label className={styles.label} htmlFor="buy-name">
          What&rsquo;s needed?
        </label>
        <input
          id="buy-name"
          className={styles.input}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          maxLength={MAX_BUY_NAME}
          autoComplete="off"
          autoCapitalize="sentences"
          placeholder="e.g. Cutting discs 4.5in"
        />
        {matches.length > 0 && (
          <div className={site.buyMatches} aria-label="In the store already">
            <p className={styles.sheetNote}>More of one of these? Tap it:</p>
            {matches.map((m) => (
              <button
                key={m.kind === "item" ? m.item.id : m.tool.id}
                type="button"
                className={site.buyMatch}
                onClick={() => {
                  setLink(m);
                  setName(m.kind === "item" ? m.item.name : m.tool.name);
                  if (m.kind === "item") {
                    setUnit(m.item.unit);
                    if (!qty && m.item.reorderQty) setQty(String(m.item.reorderQty));
                  } else setUnit("pcs");
                }}
              >
                <b>{m.kind === "item" ? m.item.name : m.tool.name}</b>
                <span>{m.kind === "item" ? `store: ${m.item.level <= 0 ? "none left" : `${qtyUnit(m.item.level, m.item.unit)} left`}` : `tool: ${m.tool.count} in all`}</span>
              </button>
            ))}
          </div>
        )}
        {(linkedItem || linkedTool) && (
          <p className={site.buyLinked}>
            {linkedItem
              ? `More of a store item: ${linkedItem.name} (${linkedItem.level <= 0 ? "none left" : `${qtyUnit(linkedItem.level, linkedItem.unit)} left`})`
              : `More of a tool: ${linkedTool!.name} (${linkedTool!.count} in all)`}
            {!editing && (
              <button type="button" className={styles.linkButton} onClick={() => setLink(null)}>
                Not that
              </button>
            )}
          </p>
        )}
        {there && (
          <div className={site.gapOdd}>
            {there.kind === "reorder" ? (
              <>On the list already: it&rsquo;s down to its reorder point. Add it here to say how many, or add a note.</>
            ) : (
              <>
                On the list already: {there.buy.name}
                {lineQty(there) ? `, ${lineQty(there)}` : ""} ({there.buy.by || "someone"}).{" "}
                {sameThing ? "Change how many there." : "Add this only if it's something else."}{" "}
                <button type="button" className={styles.linkButton} onClick={() => onOpenLine(there.key)}>
                  Change that one
                </button>
              </>
            )}
          </div>
        )}

        <label className={styles.label} htmlFor="buy-qty">
          How many? (optional)
        </label>
        <input
          id="buy-qty"
          className={`${styles.input} ${site.countInput}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="e.g. 10"
        />
        {qty.trim() !== "" && <UnitPicker id="buy-unit" value={unit} onChange={setUnit} />}

        <label className={styles.label} htmlFor="buy-note">
          Note (optional)
        </label>
        <input
          id="buy-note"
          className={styles.input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_BUY_NOTE}
          autoComplete="off"
          placeholder="e.g. the 4-inch ones, for the roof"
        />

        {!editing && <PhotoField idBase="buy" slot={slot} onPick={start} onClear={() => clear()} label="Photo (optional): a sample, the label, the broken part" />}

        <button type="button" className={urgent ? styles.urgentOn : styles.urgentOff} aria-pressed={urgent} onClick={() => setUrgent(!urgent)}>
          {urgent ? "Needed today ✓" : "Needed today?"}
        </button>
        {urgent && me.kind !== "admin" && <p className={styles.sheetNote}>The office gets a phone alert.</p>}

        <p className={styles.sheetNote}>
          Goes under: <b>{group}</b>{" "}
          <button type="button" className={styles.linkButton} onClick={() => setShowGroups(!showGroups)}>
            {showGroups ? "Done" : "Change"}
          </button>
        </p>
        {showGroups && <GroupChips value={group} onChange={setPicked} />}

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
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving || !name.trim() || sameThing}>
            {saving ? "Saving…" : editing ? "Save" : `Add${qty.trim() && Number(qty) > 0 ? ` ${buyQty(Number(qty), unit.trim())}` : ""} to the list`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Add to the shopping list" on an item's or a tool's page; "On the shopping list" (opens its line) when it's there. */
export function ShopButton({ line, onShop }: { line: BuyLine | undefined; onShop: () => void }) {
  const qty = line ? (line.kind === "buy" ? buyQty(line.buy.qty, line.buy.unit) : line.item.reorderQty ? qtyUnit(line.item.reorderQty, line.item.unit) : "") : "";
  return (
    <button type="button" className={line ? site.shopButtonOn : site.shopButton} onClick={onShop}>
      {line ? `On the shopping list${qty ? `: ${qty}` : line.kind === "reorder" ? " (running low)" : ""}` : "+ Add to the shopping list"}
    </button>
  );
}
