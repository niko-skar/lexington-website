"use client";

import { useCallback, useEffect, useState } from "react";

import type { DashboardData, SlotCount } from "@/lib/dashboard/server";
import { isPageSection, sectionHref, type Section, type TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import { startPolling } from "./api";
import home from "./Dashboard.module.css";
import { SiteHeader, SiteMenu, type View } from "./SiteChrome";
import styles from "./Todo.module.css";

// The site app's home page (Niko, 30 Oct 2026: "the site to do app will open to the dashboard page then I
// click into what information I want to put in"): one tile per part this login opens, saying how it stands
// today. A tap opens the part; the roll call's tiles open its own page on the right tab.

type Tile = { section: Section; name: string; big: string; small?: string; tone?: "warn" | "ok" };

const money = (n: number) => `GH₵ ${Math.round(n).toLocaleString("en-GH")}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function rollcallTile(r: NonNullable<DashboardData["rollcall"]>): Tile {
  // The latest check that has marks, else "not marked yet".
  const slots: Array<[string, SlotCount]> = [
    ["closing", r.closing],
    ["afternoon", r.afternoon],
    ["morning", r.morning],
  ];
  const latest = slots.find(([, s]) => s.marked > 0);
  const pours = [r.curing ? `${r.curing} ${r.curing === 1 ? "pour" : "pours"} curing` : "", r.checklists ? `${r.checklists} pour ${r.checklists === 1 ? "checklist" : "checklists"} open` : ""]
    .filter(Boolean)
    .join(" · ");
  return latest
    ? { section: "rollcall", name: "Roll call", big: `${latest[1].here} here`, small: [`at the ${latest[0]} check`, pours].filter(Boolean).join(" · "), tone: "ok" }
    : { section: "rollcall", name: "Roll call", big: "Not marked yet", small: [`${r.onBooks} on the books`, pours].filter(Boolean).join(" · "), tone: "warn" };
}

function tiles(d: DashboardData, unread: number): Tile[] {
  const out: Tile[] = [];
  if (d.rollcallMoving) out.push({ section: "rollcall", name: "Roll call", big: "Moving in", small: "on Sunday morning; until then, the Site Roll Call page" });
  if (d.rollcall) out.push(rollcallTile(d.rollcall));
  if (d.payday) {
    const p = d.payday;
    out.push(
      p.worked
        ? { section: "payday", name: "Payday", big: `${p.paid} of ${p.worked} paid`, small: `pay week from ${shortDay(p.weekStart)}`, tone: p.paid >= p.worked ? "ok" : undefined }
        : { section: "payday", name: "Payday", big: "Nothing to pay yet", small: `pay week from ${shortDay(p.weekStart)}` }
    );
  }
  if (d.todo) {
    const t = d.todo;
    out.push({ section: "todo", name: "To-do", big: `${t.open} to do`, small: `${t.urgent} urgent · ${t.doneToday} done today`, tone: t.urgent ? "warn" : undefined });
  }
  if (d.store) {
    const s = d.store;
    out.push({
      section: "store",
      name: "Store",
      big: s.reorders ? `${s.reorders} to reorder` : "Stock fine",
      small: [`${s.toolsOut} ${s.toolsOut === 1 ? "tool" : "tools"} out`, s.opened ? `opened ${clock(s.opened)}${s.closed ? `, closed ${clock(s.closed)}` : ""}` : "not opened today"].join(" · "),
      tone: s.reorders ? "warn" : undefined,
    });
  }
  if (d.workers) out.push({ section: "workers", name: "Workers", big: `${d.workers.active} on the books`, small: "names, numbers, ID photos" });
  if (d.expenses) out.push({ section: "expenses", name: "Expenses", big: money(d.expenses.monthOut), small: `on site this month · ${d.expenses.monthCount} ${d.expenses.monthCount === 1 ? "entry" : "entries"}` });
  if (d.alerts) out.push({ section: "alerts", name: "Alerts", big: unread ? `${unread} new` : "All caught up", tone: unread ? "warn" : "ok" });
  return out;
}

export function Dashboard({ me, active, onGo, unread }: { me: TodoMe; active: boolean; onGo: (view: View) => void; unread: number }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [offline, setOffline] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (response.status === 401) {
        window.location.reload(); // signed out: the app's own sign-in comes up
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as DashboardData);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => void refresh(), 0);
    const stop = startPolling(refresh, 30_000, 120_000);
    return () => {
      clearTimeout(first);
      stop();
    };
  }, [active, refresh]);

  const list = data ? tiles(data, data.alerts ? unread : 0) : [];

  return (
    <>
      <SiteHeader eyebrow="The Lexington" title={data ? longDay(data.today) : "Today"} sub={`Hello, ${me.name.split(" ")[0]}`} onMenu={() => setMenuOpen(true)} />
      {offline && (
        <div className={styles.banner} role="status">
          No signal: the figures will come when it&rsquo;s back.
        </div>
      )}
      <main className={styles.main}>
        {!data ? (
          <p className={styles.loading}>Loading…</p>
        ) : (
          <div className={home.tiles}>
            {/* The roll call is its own page (a plain link); the other parts open here at once. */}
            {list.map((t) => (
              <a
                key={t.section}
                href={sectionHref(t.section)}
                className={`${home.tile} ${t.tone === "warn" ? home.warn : t.tone === "ok" ? home.ok : ""}`}
                onClick={(e) => {
                  if (!isPageSection(t.section) || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onGo(t.section);
                }}
              >
                <span className={home.name}>{t.name}</span>
                <span className={home.big}>{t.big}</span>
                {t.small && <span className={home.small}>{t.small}</span>}
              </a>
            ))}
          </div>
        )}
      </main>
      {menuOpen && <SiteMenu me={me} onClose={() => setMenuOpen(false)} onRefresh={() => void refresh()} onLogins={() => setAccessOpen(true)} />}
      {accessOpen && <AccessSheet onClose={() => setAccessOpen(false)} />}
    </>
  );
}
