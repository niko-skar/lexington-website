import Link from "next/link";

import { AdsView, type GoogleState, type MetaState } from "@/components/dashboard/AdsView";
import styles from "@/components/dashboard/Dashboard.module.css";
import { VisitorsView } from "@/components/dashboard/VisitorsView";
import { WatchdogPanel } from "@/components/dashboard/WatchdogPanel";
import { readWatchdog } from "@/lib/agents/watchdog";
import { summariseGoogle } from "@/lib/ads/google";
import { readGoogleReport } from "@/lib/ads/googleStore";
import { fetchMetaReport, metaConfig } from "@/lib/ads/meta";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import {
  PAGE_SIZE,
  RANGE_LABELS,
  VISIT_RANGES,
  buildStories,
  currentTimeMs,
  overviewOf,
  parseFilter,
  parseLimit,
  parseRange,
  rangeDays,
  shiftDay,
  sourceLines,
  type VisitFilter,
  type VisitRange,
} from "@/lib/visits/report";
import { readVisitLogs } from "@/lib/visits/store";

export const metadata = {
  title: "Dashboard | The Lexington",
};

// "Check now" (the ads watchdog) runs here and reads Meta, Google and the CRM.
export const maxDuration = 120;

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * How the adverts are doing and how visitors use the site (Niko, 13 Oct 2026).
 * Two tabs: Ads (what Meta and Google say, and what ad visitors did on the
 * site) and Visitors (the anonymous visit record: every visit's route). The
 * days apply to both.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdminPage();

  const params = await searchParams;
  const view = one(params.view) === "visitors" ? "visitors" : "ads";
  const range = parseRange(one(params.range), "7d");
  const filter = parseFilter(one(params.show));
  const limit = parseLimit(one(params.limit));

  const days = rangeDays(range, currentTimeMs());
  const bounds = { from: `${days[0]}T00:00:00.000Z`, to: `${shiftDay(days[days.length - 1], 1)}T00:00:00.000Z` };

  // The day before the range too, so a visit that crossed midnight into it is whole.
  const logsPromise = readVisitLogs([shiftDay(days[0], -1), ...days]);
  const config = view === "ads" ? metaConfig() : null;
  const [logs, metaResult, googleReport, watchdog] = await Promise.all([
    logsPromise,
    config ? fetchMetaReport(config, days[0], days[days.length - 1]) : Promise.resolve(null),
    view === "ads" ? readGoogleReport() : Promise.resolve(null),
    readWatchdog(),
  ]);

  const stories = buildStories(logs.visits, logs.events, bounds);

  const href = (over: { view?: "ads" | "visitors"; range?: VisitRange; show?: VisitFilter; limit?: number }) => {
    const query = new URLSearchParams();
    const nextView = over.view ?? view;
    const nextRange = over.range ?? range;
    if (nextView !== "ads") query.set("view", nextView);
    if (nextRange !== "7d") query.set("range", nextRange);
    if (nextView === "visitors") {
      const nextShow = over.show ?? filter;
      if (nextShow !== "all") query.set("show", nextShow);
      if (over.limit && over.limit > PAGE_SIZE) query.set("limit", String(over.limit));
    }
    const text = query.toString();
    return text ? `/admin/dashboard?${text}` : "/admin/dashboard";
  };

  const meta: MetaState = { connected: config !== null, result: metaResult };
  const google: GoogleState = {
    connected: (process.env.GOOGLE_ADS_REPORT_SECRET ?? "").trim().length >= 16,
    summary: googleReport && googleReport.rows.length > 0 ? summariseGoogle(googleReport.rows, days) : null,
    receivedAt: googleReport?.receivedAt ?? null,
    error: googleReport?.error ?? null,
  };

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>Dashboard</h1>
        <nav aria-label="Days shown" className={styles.chips} style={{ marginBottom: 0 }}>
          {VISIT_RANGES.map((value) => (
            <Link
              key={value}
              href={href({ range: value, limit: PAGE_SIZE })}
              className={value === range ? styles.chipActive : styles.chip}
              aria-current={value === range ? "page" : undefined}
            >
              {RANGE_LABELS[value]}
            </Link>
          ))}
        </nav>
        <Link href="/admin/dashboard/connect" className={styles.toolLink}>
          Connect ad accounts
        </Link>
      </div>

      <WatchdogPanel run={watchdog} />

      <nav aria-label="Dashboard" className={styles.tabs}>
        <Link href={href({ view: "ads" })} className={view === "ads" ? styles.tabActive : styles.tab} aria-current={view === "ads" ? "page" : undefined}>
          Ads
        </Link>
        <Link
          href={href({ view: "visitors" })}
          className={view === "visitors" ? styles.tabActive : styles.tab}
          aria-current={view === "visitors" ? "page" : undefined}
        >
          Visitors
        </Link>
      </nav>

      {view === "ads" ? (
        <AdsView meta={meta} google={google} lines={sourceLines(stories)} visitsError={logs.error} />
      ) : (
        <VisitorsView
          overview={overviewOf(stories, days)}
          stories={stories}
          filter={filter}
          limit={limit}
          hrefFor={(over) => href(over)}
          today={range === "today"}
          error={logs.error}
        />
      )}
    </main>
  );
}
