import type { Change, Floor, SlabEdge } from "./types";

/**
 * The only places a change may write to, as Sanity patch paths, e.g.
 *   columns[_key=="D3"].actual      grid[_key=="xD"].shift
 *   slab.edges[_key=="e3"].actual   openings[_key=="v1a2b"]   (a whole opening)
 *   slab.edges                      (every slab edge at once: an edge split in two, or joined back)
 * Shared by the page (to show a change at once) and the server (to check and
 * store it), so both read a path the same way.
 */

export type ListName = "grid" | "columns" | "cores" | "openings" | "slab.edges";
export type FieldName =
  "shift" | "measured" | "actual" | "at" | "note" | "removed" | "name" | "kind" | "w" | "h" | "gx" | "gy" | "edges";

export interface ParsedPath {
  list: ListName;
  key: string;
  /** Undefined = the whole item (adding or deleting an opening). */
  field?: FieldName;
  /** The whole list (only the slab edges: a split or a join changes how many there are). */
  all?: true;
}

/** Every slab edge at once, in their order round the outline. */
export const EDGES_PATH = "slab.edges";

const PATH_RE =
  /^(grid|columns|cores|openings|slab\.edges)\[_key=="([A-Za-z0-9_-]{1,40})"\](?:\.(shift|measured|actual|at|note|removed|name|kind|w|h|gx|gy|edges))?$/;

const FIELDS_BY_LIST: Record<ListName, FieldName[]> = {
  grid: ["shift", "measured"],
  "slab.edges": ["actual", "at"],
  columns: ["actual", "at", "note", "w", "h", "gx", "gy", "edges"],
  cores: ["actual", "at", "note", "w", "h", "gx", "gy", "edges"],
  openings: ["actual", "at", "note", "removed", "name", "kind"],
};

export function parsePath(path: string): ParsedPath | null {
  if (path === EDGES_PATH) return { list: "slab.edges", key: "", all: true };
  const m = PATH_RE.exec(path);
  if (!m) return null;
  const list = m[1] as ListName;
  const field = m[3] as FieldName | undefined;
  if (field && !FIELDS_BY_LIST[list].includes(field)) return null;
  // Only openings can be added or removed whole.
  if (!field && list !== "openings") return null;
  return { list, key: m[2], field };
}

export function pathOf(list: ListName, key: string, field?: FieldName): string {
  return `${list}[_key=="${key}"]${field ? `.${field}` : ""}`;
}

type Item = { _key: string } & Record<string, unknown>;

function itemsOf(floor: Floor, list: ListName): Item[] | null {
  if (list === "slab.edges") return (floor.slab?.edges as unknown as Item[] | undefined) ?? null;
  return (floor[list] as unknown as Item[] | undefined) ?? null;
}

/** The item a path points into (a column, an edge, a grid line...), or null. */
export function getItem(floor: Floor, list: ListName, key: string): Record<string, unknown> | null {
  return itemsOf(floor, list)?.find((i) => i._key === key) ?? null;
}

/** The value at a path now (null when it isn't set or the item doesn't exist). */
export function getAt(floor: Floor, path: string): unknown {
  const p = parsePath(path);
  if (!p) return null;
  if (p.all) return floor.slab?.edges ?? null;
  const item = itemsOf(floor, p.list)?.find((i) => i._key === p.key);
  if (!item) return null;
  if (!p.field) return item;
  return item[p.field] ?? null;
}

/** A copy of the floor with the changes applied, in order. */
export function applyChanges(floor: Floor, changes: Change[]): Floor {
  const next: Floor = structuredClone(floor);
  for (const change of changes) {
    const p = parsePath(change.path);
    if (!p) continue;
    if (p.all) {
      if (next.slab && Array.isArray(change.value)) next.slab.edges = structuredClone(change.value) as SlabEdge[];
      continue;
    }
    const items = itemsOf(next, p.list);
    if (!items) continue;
    const index = items.findIndex((i) => i._key === p.key);
    if (!p.field) {
      if (change.value === null) {
        if (index >= 0) items.splice(index, 1);
      } else if (index >= 0) {
        items[index] = structuredClone(change.value) as Item;
      } else {
        items.push(structuredClone(change.value) as Item);
      }
      continue;
    }
    if (index < 0) continue;
    if (change.value === null || change.value === undefined) {
      delete items[index][p.field];
    } else {
      items[index][p.field] = structuredClone(change.value);
    }
  }
  return next;
}

// Key order can differ once a value has been through the database, so sort keys first.
function stable(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined && obj[k] !== null)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Same values? (Numbers, booleans, strings, null and the small face objects.) */
export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
