// The roll call's tabs, apart from the roll call itself (18 Nov 2026): the app's frame reads an address's tab before
// the roll call's own code has loaded (components/todo/RollcallPart.tsx is fetched only when the roll call opens).
export type RollcallTab = "today" | "week" | "workers";
export const isRollcallTab = (v: unknown): v is RollcallTab => v === "today" || v === "week" || v === "workers";
/** The tab an address asks for: /todo/rollcall#week is Payday. */
export const rollcallTabOf = (hash: string): RollcallTab | null => {
  const t = hash.replace(/^#/, "");
  return isRollcallTab(t) ? t : null;
};
