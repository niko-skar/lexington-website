import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { QBO_LISTS_ID } from "@/lib/site/ids";
import type { BookLists, BookNamed } from "./books";

// The company's QuickBooks classes and locations, kept in the website: the expense form offers them on every
// phone without asking QuickBooks each time. Read again from QuickBooks when the QuickBooks page opens and,
// when they're a few hours old, after the expenses are opened (lib/quickbooks/feed.ts refreshBookLists).

export const BOOK_LISTS_STALE_MS = 6 * 3600_000;

export async function cachedBookLists(): Promise<BookLists> {
  const doc = await getBuyersClient().fetch<BookLists | null>(`*[_id == $id][0]{ classes, locations, fetchedAt }`, { id: QBO_LISTS_ID });
  const tidy = (list: unknown): BookNamed[] =>
    Array.isArray(list) ? list.filter((x) => x && typeof x.id === "string" && typeof x.name === "string").map((x) => ({ id: x.id, name: x.name })) : [];
  return { classes: tidy(doc?.classes), locations: tidy(doc?.locations), fetchedAt: doc?.fetchedAt ?? null };
}

export async function saveBookLists(lists: { classes: BookNamed[]; locations: BookNamed[] }): Promise<BookLists> {
  const fetchedAt = new Date().toISOString();
  const keyed = (list: BookNamed[]) => list.map((x) => ({ _key: `k${x.id.replace(/[^A-Za-z0-9]/g, "")}`, id: x.id, name: x.name }));
  await getBuyersClient().createOrReplace({ _id: QBO_LISTS_ID, _type: "qboBookLists", classes: keyed(lists.classes), locations: keyed(lists.locations), fetchedAt });
  return { classes: lists.classes, locations: lists.locations, fetchedAt };
}
