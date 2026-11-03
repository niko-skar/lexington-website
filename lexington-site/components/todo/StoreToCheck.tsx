"use client";

import { useState } from "react";

import { tradeOfItem, tradeOfTool } from "@/lib/store/categories";
import { CONDITION_NAMES, qtyUnit, TRADE_NAMES, type StoreItem, type StoreTool } from "@/lib/store/shared";
import { photoAt } from "@/lib/todo/shared";
import { errorText, send } from "./api";
import site from "./Site.module.css";
import { CameraIcon } from "./StoreBits";
import styles from "./Todo.module.css";

// The office's "To check" (Niko, 3 Nov 2026: "put all the things that are entered not by myself into the store room as
// a list i need to work through and check the name and the qty myself ... they often get the names wrong"): every item
// and tool a site login added, oldest first, with its name, how many, who added it; "Looks right", change it, or delete
// it. Only the office sees it: for the site logins the store looks as it always does.

type Entry = { type: "item"; item: StoreItem } | { type: "tool"; tool: StoreTool };
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });

/** What waits for the office's check, oldest first. */
export function toCheckOf(items: readonly StoreItem[], tools: readonly StoreTool[]): Entry[] {
  return [
    ...items.filter((i) => i.review).map((item) => ({ type: "item" as const, item })),
    ...tools.filter((t) => t.review).map((tool) => ({ type: "tool" as const, tool })),
  ].sort((a, b) => (a.type === "item" ? a.item.review!.at : a.tool.review!.at).localeCompare(b.type === "item" ? b.item.review!.at : b.tool.review!.at));
}

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
}) {
  const list = toCheckOf(items, tools);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState("");

  const right = async (e: Entry) => {
    const id = e.type === "item" ? e.item.id : e.tool.id;
    setBusy(id);
    setError("");
    try {
      if (e.type === "item") onItem((await send<{ item: StoreItem }>(`/api/store/items/${id}`, "PATCH", { reviewed: true })).item);
      else onTool((await send<{ tool: StoreTool }>(`/api/store/tools/${id}`, "PATCH", { reviewed: true })).tool);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (e: Entry) => {
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
      <div className={`${styles.sheet} ${site.sheetTall}`} role="dialog" aria-label="To check">
        <h2 className={styles.sheetTitle}>To check</h2>
        <p className={styles.sheetNote}>
          New things the site logins added to the store room. Check each name and how many: &ldquo;Looks right&rdquo;, or change it. They don&rsquo;t see this list.
        </p>
        {error && <p className={styles.sheetError}>{error}</p>}
        {list.length === 0 ? (
          <p className={styles.sheetNote}>Nothing left to check.</p>
        ) : (
          <div className={site.sheetEntries}>
            {list.map((e) => {
              const id = e.type === "item" ? e.item.id : e.tool.id;
              const photo = e.type === "item" ? e.item.photoUrl : e.tool.photoUrl;
              const review = (e.type === "item" ? e.item.review : e.tool.review)!;
              const trade = e.type === "item" ? tradeOfItem(e.item) : tradeOfTool(e.tool);
              return (
                <article key={id} className={site.checkCard} aria-label={`To check: ${e.type === "item" ? e.item.name : e.tool.name}`}>
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
                      {e.type === "item" ? e.item.name : e.tool.name}
                      <small>
                        {e.type === "item"
                          ? `${qtyUnit(e.item.level, e.item.unit)} · material${e.item.category ? ` · ${e.item.category}` : ""}`
                          : `${e.tool.count} · tool${e.tool.condition ? ` · ${CONDITION_NAMES[e.tool.condition].toLowerCase()}` : ""}`}
                        {trade !== "all" ? ` · ${TRADE_NAMES[trade]}` : ""}
                      </small>
                      <small>
                        Added by {review.by} · {when(review.at)}
                      </small>
                    </span>
                  </div>
                  <div className={site.reorderButtons}>
                    <button type="button" onClick={() => void right(e)} disabled={busy === id}>
                      {busy === id ? "Saving…" : "✓ Looks right"}
                    </button>
                    <button type="button" onClick={() => (e.type === "item" ? onChangeItem(e.item) : onChangeTool(e.tool))} disabled={busy === id}>
                      Change
                    </button>
                    <button type="button" className={armed === id ? styles.dangerArmed : undefined} onClick={() => (armed === id ? void remove(e) : setArmed(id))} disabled={busy === id}>
                      {armed === id ? "Tap again: delete" : "Delete"}
                    </button>
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
