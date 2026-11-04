"use client";

import { useState } from "react";

import { tradeOfItem, tradeOfTool } from "@/lib/store/categories";
import type { StoreDouble } from "@/lib/store/doubles";
import { CONDITION_NAMES, qtyUnit, TRADE_NAMES, type StoreItem, type StoreReview, type StoreTool } from "@/lib/store/shared";
import { photoAt } from "@/lib/todo/shared";
import { errorText, send } from "./api";
import site from "./Site.module.css";
import { CameraIcon } from "./StoreBits";
import { EntryTop, findEntry, type ListEntry } from "./StoreDoubles";
import styles from "./Todo.module.css";

// The office's "To check" (Niko, 3 Nov 2026: "put all the things that are entered not by myself into the store room as
// a list i need to work through and check the name and the qty myself ... they often get the names wrong"): every item
// and tool a site login added, with its name, how many, who added it; "Looks right", change it, or delete it. Only the
// office sees it: for the site logins the store looks as it always does.
// 4 Nov 2026 ("mark if it's similar for me as well"): what each might be a double of (StoreDoubles.tsx), with "Same
// thing: put together"; and a tool on the list a site login counted differently. Those come first.

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });

const reviewOf = (e: ListEntry) => (e.type === "item" ? e.item.review : e.tool.review)!;

/** Its look-alikes still on the list. */
function doublesOf(e: ListEntry, items: readonly StoreItem[], tools: readonly StoreTool[]): { d: StoreDouble; entry: ListEntry }[] {
  return (reviewOf(e).doubles ?? []).flatMap((d) => {
    const entry = findEntry(d, items, tools);
    return entry && (entry.type === "item" ? entry.item.id : entry.tool.id) !== (e.type === "item" ? e.item.id : e.tool.id) ? [{ d, entry }] : [];
  });
}
/** Something to look at first: a likely double, or a count that isn't the list's. */
const flagged = (e: ListEntry, items: readonly StoreItem[], tools: readonly StoreTool[]) => doublesOf(e, items, tools).length > 0 || !!reviewOf(e).counted;

/** What waits for the office's check: the flagged ones first, then the rest, each oldest first. */
export function toCheckOf(items: readonly StoreItem[], tools: readonly StoreTool[]): ListEntry[] {
  return [
    ...items.filter((i) => i.review).map((item) => ({ type: "item" as const, item })),
    ...tools.filter((t) => t.review).map((tool) => ({ type: "tool" as const, tool })),
  ].sort((a, b) => Number(flagged(b, items, tools)) - Number(flagged(a, items, tools)) || reviewOf(a).at.localeCompare(reviewOf(b).at));
}

/** How many on the list might be doubles (for the bar on the store page). */
export const maybeDoubles = (list: readonly ListEntry[], items: readonly StoreItem[], tools: readonly StoreTool[]) => list.filter((e) => doublesOf(e, items, tools).length > 0).length;

export function ToCheckSheet({
  items,
  tools,
  onClose,
  onItem,
  onTool,
  onChangeItem,
  onChangeTool,
  onDeletedItem,
  onDeletedTool,
  onTogether,
}: {
  items: readonly StoreItem[];
  tools: readonly StoreTool[];
  onClose: () => void;
  /** Checked ("Looks right"): as the server has it now. */
  onItem: (item: StoreItem) => void;
  onTool: (tool: StoreTool) => void;
  /** "Change": the office's change sheet (saving it checks it too). */
  onChangeItem: (item: StoreItem) => void;
  onChangeTool: (tool: StoreTool) => void;
  onDeletedItem: (item: StoreItem) => void;
  onDeletedTool: (tool: StoreTool) => void;
  /** "Same thing: put together": this one into the one it's a double of. */
  onTogether: (from: ListEntry, into: ListEntry) => void;
}) {
  const list = toCheckOf(items, tools);
  const flags = list.filter((e) => flagged(e, items, tools)).length;
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState("");

  const right = async (e: ListEntry, change: Record<string, unknown> = { reviewed: true }) => {
    const id = e.type === "item" ? e.item.id : e.tool.id;
    setBusy(id);
    setError("");
    try {
      if (e.type === "item") onItem((await send<{ item: StoreItem }>(`/api/store/items/${id}`, "PATCH", change)).item);
      else onTool((await send<{ tool: StoreTool }>(`/api/store/tools/${id}`, "PATCH", change)).tool);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (e: ListEntry) => {
    const id = e.type === "item" ? e.item.id : e.tool.id;
    setBusy(id);
    setError("");
    try {
      await send(`/api/store/${e.type === "item" ? "items" : "tools"}/${id}`, "DELETE");
      if (e.type === "item") onDeletedItem(e.item);
      else onDeletedTool(e.tool);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
      setArmed(null);
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={`${styles.sheet} ${site.sheetTall} ${site.sheetWide}`} role="dialog" aria-label="To check">
        <h2 className={styles.sheetTitle}>To check{list.length ? ` · ${list.length}` : ""}</h2>
        <p className={styles.sheetNote}>
          New things the site logins added to the store room. Check each name and how many: &ldquo;Looks right&rdquo;, or change it. They don&rsquo;t see this list.
          {flags ? ` ${flags === 1 ? "One might be a double or has a count to check: it's" : `${flags} might be doubles or have a count to check: they're`} first.` : ""}
        </p>
        {error && <p className={styles.sheetError}>{error}</p>}
        {list.length === 0 ? (
          <p className={styles.sheetNote}>Nothing left to check.</p>
        ) : (
          <div className={site.checkList}>
            {list.map((e) => {
              const id = e.type === "item" ? e.item.id : e.tool.id;
              const name = e.type === "item" ? e.item.name : e.tool.name;
              const photo = e.type === "item" ? e.item.photoUrl : e.tool.photoUrl;
              const review: StoreReview = reviewOf(e);
              const trade = e.type === "item" ? tradeOfItem(e.item) : tradeOfTool(e.tool);
              const doubles = doublesOf(e, items, tools);
              const counted = e.type === "tool" ? review.counted : null;
              const onlyCounted = review.what === "counted";
              return (
                <article key={id} className={`${site.checkCard} ${doubles.length || counted ? site.checkFlag : ""}`} aria-label={`To check: ${name}`}>
                  <div className={site.checkTop}>
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a resized copy from the image store
                      <img className={site.itemThumb} src={photoAt(photo, 120)} alt="" loading="lazy" />
                    ) : (
                      <span className={site.itemThumbEmpty} aria-hidden="true">
                        <CameraIcon />
                      </span>
                    )}
                    <span className={site.itemName}>
                      {name}
                      <small>
                        {e.type === "item"
                          ? `${qtyUnit(e.item.level, e.item.unit)} · material${e.item.category ? ` · ${e.item.category}` : ""}`
                          : `${e.tool.count} · tool${e.tool.condition ? ` · ${CONDITION_NAMES[e.tool.condition].toLowerCase()}` : ""}`}
                        {trade !== "all" ? ` · ${TRADE_NAMES[trade]}` : ""}
                      </small>
                      {!onlyCounted && (
                        <small>
                          Added by {review.by} · {when(review.at)}
                        </small>
                      )}
                    </span>
                  </div>
                  {counted && (
                    <p className={site.gapOdd}>
                      {counted.by} counted {counted.count} on {when(counted.at)}: the list says {counted.was}.
                    </p>
                  )}
                  {doubles.length > 0 && (
                    <div className={site.doubleList}>
                      <p className={site.doubleHead}>{doubles.some((x) => x.d.sure) ? "Looks like a double of" : "Might be a double of"}</p>
                      {doubles.map(({ d, entry }) => (
                        <div key={d.id} className={site.doubleCard}>
                          <EntryTop entry={entry}>
                            {(entry.type === "item" ? entry.item.review : entry.tool.review) && <small>On To check too</small>}
                          </EntryTop>
                          {d.why && <p className={site.doubleWhy}>{d.why}</p>}
                          {entry.type === e.type ? (
                            <div className={site.reorderButtons}>
                              <button type="button" onClick={() => onTogether(e, entry)} disabled={busy === id}>
                                Same thing: put together
                              </button>
                            </div>
                          ) : (
                            <p className={site.doubleSaid}>It&rsquo;s on the {entry.type === "tool" ? "tool list" : "materials"}: if it&rsquo;s the same thing, delete this one.</p>
                          )}
                        </div>
                      ))}
                      <p className={site.doubleSaid}>
                        {review.said === "new" ? `${review.by} was asked and said it's something new.` : "Found by the check after it was added."}
                      </p>
                    </div>
                  )}
                  <div className={site.reorderButtons}>
                    {counted && e.type === "tool" && (
                      <button type="button" onClick={() => void right(e, { count: counted.count })} disabled={busy === id}>
                        {busy === id ? "Saving…" : `Make it ${counted.count}`}
                      </button>
                    )}
                    <button type="button" onClick={() => void right(e)} disabled={busy === id}>
                      {busy === id && !counted ? "Saving…" : counted && e.type === "tool" ? `Keep ${e.tool.count}` : doubles.length ? "✓ Different: looks right" : "✓ Looks right"}
                    </button>
                    <button type="button" onClick={() => (e.type === "item" ? onChangeItem(e.item) : onChangeTool(e.tool))} disabled={busy === id}>
                      Change
                    </button>
                    {!onlyCounted && (
                      <button type="button" className={armed === id ? styles.dangerArmed : undefined} onClick={() => (armed === id ? void remove(e) : setArmed(id))} disabled={busy === id}>
                        {armed === id ? "Tap again: delete" : "Delete"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <button type="button" className={styles.sheetCancel} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
