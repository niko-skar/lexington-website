"use client";

import { useCallback, useEffect, useState } from "react";

import type { DashboardData, SlotCount } from "@/lib/dashboard/server";
import { isPageSection, sectionHref, type Section, type TodoMe } from "@/lib/todo/shared";
import { AccessSheet } from "./AccessSheet";
import type { RollcallTab } from "./RollcallPart";
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
  if (d.concrete) {
    const c = d.concrete;
    const load = `${c.trucks} ${c.trucks === 1 ? "truck" : "trucks"} · ${Math.round(c.volume * 10) / 10} m³`;
    out.push(
      c.day === d.today
        ? { section: "concrete", name: "Concrete", big: load, small: c.flagged ? `${c.flagged} to look at` : "all on time today", tone: c.flagged ? "warn" : "ok" }
        : { section: "concrete", name: "Concrete", big: "No trucks today", small: c.day ? `last pour ${shortDay(c.day)}: ${load}` : "photo each waybill on pour days" }
    );
  }
  if (d.expenses) {
    const x = d.expenses;
    out.push({
      section: "expenses",
      name: "Expenses",
      big: money(x.monthOut),
      small: `on site this month · ${x.monthCount} ${x.monthCount === 1 ? "entry" : "entries"}${x.fromBank ? ` · ${x.fromBank} from the bank to complete` : ""}`,
      tone: x.fromBank ? "warn" : undefined,
    });
  }
  if (d.steel) {
    const x = d.steel;
    const t = (n: number) => `${Math.round(n * 10) / 10} t`;
    const toType = x.unknown ? `${x.unknown} ${x.unknown === 1 ? "buy" : "buys"} with no tons` : "";
    out.push(
      x.installed > 0
        ? {
            section: "steel",
            name: "Steel",
            big: x.owed >= 0 ? `${money(x.owed)} owed` : `${money(-x.owed)} paid ahead`,
            small: [`${t(x.installed)} installed · ${t(Math.max(x.stock, 0))} in stock`, toType].filter(Boolean).join(" · "),
            tone: x.unknown || x.stock < 0 ? "warn" : undefined,
          }
        : { section: "steel", name: "Steel", big: "Log the tons installed", small: [`${t(x.bought)} bought · ${money(x.paid)} paid`, toType].filter(Boolean).join(" · "), tone: "warn" }
    );
  }
  if (d.buyers) {
    const x = d.buyers;
    const usd = (n: number) => `US$ ${n.toLocaleString("en-US")}`;
    out.push({
      section: "buyers",
      name: "Buyers",
      big: `${usd(x.paidUSD)} paid`,
      small: [`of ${usd(x.priceUSD)} · ${x.count} ${x.count === 1 ? "buyer" : "buyers"}`, x.last ? `last: ${x.last.name.split(" ")[0]}${x.last.date ? `, ${shortDay(x.last.date)}` : ""}` : ""].filter(Boolean).join(" · "),
    });
  }
  if (d.alerts) out.push({ section: "alerts", name: "Alerts", big: unread ? `${unread} new` : "All caught up", tone: unread ? "warn" : "ok" });
  return out;
}

export function Dashboard({
  me,
  active,
  onGo,
  onRollcall,
  unread,
}: {
  me: TodoMe;
  active: boolean;
  onGo: (view: View) => void;
  /** The roll call's tiles open it in the app, on their tab. */
  onRollcall: (tab: RollcallTab) => void;
  unread: number;
}) {
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
            {/* Every part opens here at once; the roll call's tiles on their tab. */}
            {list.map((t) => (
              <a
                key={t.section}
                href={sectionHref(t.section)}
                className={`${home.tile} ${t.tone === "warn" ? home.warn : t.tone === "ok" ? home.ok : ""}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  const rcTab = t.section === "rollcall" ? "today" : t.section === "payday" ? "week" : t.section === "workers" ? "workers" : null;
                  if (rcTab) {
                    e.preventDefault();
                    onRollcall(rcTab);
                    return;
                  }
                  if (!isPageSection(t.section)) return;
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
