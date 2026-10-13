import Link from "next/link";

import {
  ACTION_NAMES,
  arrivalPhrase,
  durationText,
  isAction,
  pageName,
  sourceName,
  troubleText,
} from "@/lib/visits/rules";
import {
  FILTER_LABELS,
  PAGE_SIZE,
  VISIT_FILTERS,
  filterStories,
  percent,
  type Overview,
  type VisitFilter,
  type VisitStory,
} from "@/lib/visits/report";

import styles from "./Dashboard.module.css";
import { Counts, DayColumns, SectionHead, Tiles, browserName, countryName, deviceName, formatCount } from "./parts";

/**
 * How visitors use the public site, from the anonymous visit record: the totals,
 * where visits end and go wrong, what people did, who they are, and each visit
 * as a story of the pages it saw.
 */
export function VisitorsView({
  overview,
  stories,
  filter,
  limit,
  hrefFor,
  today,
  error,
}: {
  overview: Overview;
  stories: VisitStory[];
  filter: VisitFilter;
  limit: number;
  hrefFor: (over: { show?: VisitFilter; limit?: number }) => string;
  today: boolean;
  error: string | null;
}) {
  if (error) {
    return <p className={styles.error}>The visits could not be read just now ({error}). Reload the page in a minute.</p>;
  }
  if (overview.visits === 0) {
    return (
      <p className={styles.empty}>
        No visits in this time yet. Visits appear here as people use the website; a visit shows up a second or two after a page
        opens. Your own visits are not counted when your browser says &ldquo;Do Not Track&rdquo;.
      </p>
    );
  }

  const shown = filterStories(stories, filter);
  const page = shown.slice(0, limit);

  return (
    <>
      <Tiles
        tiles={[
          { label: "Visits", value: formatCount(overview.visits), hint: "each open tab counts once" },
          {
            label: "Got in touch",
            value: formatCount(overview.contacted),
            hint: `${percent(overview.contacted, overview.visits)}% sent an enquiry, WhatsApp, called or emailed`,
          },
          {
            label: "Left after one page",
            value: `${percent(overview.onePage, overview.visits)}%`,
            hint: `${formatCount(overview.onePage)} of ${formatCount(overview.visits)} visits`,
          },
          {
            label: "Time on the site",
            value: overview.medianSeconds != null ? durationText(overview.medianSeconds * 1000) : "—",
            hint: "half the visits stay longer than this",
          },
          { label: "Pages a visit", value: overview.pagesAvg.toFixed(1), hint: "on average" },
          {
            label: "Something went wrong",
            value: formatCount(overview.flagged),
            hint: `${percent(overview.flagged, overview.visits)}% of visits (see below)`,
            warn: overview.flagged > 0,
          },
        ]}
      />

      {overview.byDay.length > 1 && (
        <section className={styles.section} aria-labelledby="per-day">
          <SectionHead id="per-day" title="Visits each day" />
          <DayColumns
            title="Visits"
            total={`${formatCount(overview.visits)} in all`}
            points={overview.byDay.map((day) => ({
              day: day.day,
              value: day.visits,
              note: day.contacted > 0 ? `${day.contacted} got in touch` : undefined,
            }))}
            format={formatCount}
          />
        </section>
      )}

      <div className={`${styles.grid2} ${styles.section}`}>
        <section aria-labelledby="leave" className={styles.panel}>
          <SectionHead id="leave" title="Where people leave" hint="The pages visits ended on most, how often each was seen, and how long it was open." />
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col" className={styles.num}>Seen</th>
                  <th scope="col" className={styles.num}>Left from</th>
                  <th scope="col" className={styles.num}>Open for</th>
                </tr>
              </thead>
              <tbody>
                {overview.pages.map((figure) => (
                  <tr key={figure.path}>
                    <th scope="row">
                      {pageName(figure.path)}
                      {pageName(figure.path) !== figure.path && <span className={styles.sub}>{figure.path}</span>}
                    </th>
                    <td className={styles.num}>{formatCount(figure.views)}</td>
                    <td className={styles.num}>
                      {formatCount(figure.exits)}
                      <span className={styles.share}>{percent(figure.exits, figure.views)}%</span>
                    </td>
                    <td className={styles.num}>{figure.seconds != null ? durationText(figure.seconds * 1000) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="trouble" className={styles.panel}>
          <SectionHead id="trouble" title="Where it goes wrong" hint="Moments that suggest a visitor was stuck, most common first." />
          {overview.trouble.length === 0 ? (
            <p className={styles.muted}>Nothing suggested trouble in this time.</p>
          ) : (
            <ul className={styles.storyNotes}>
              {overview.trouble.map((item) => (
                <li key={`${item.path}|${item.kind}|${item.label}`} className={styles.noteWarn}>
                  <strong>{pageName(item.path)}:</strong> {troubleText(item.kind, item.label || null, null)}{" "}
                  <span className={styles.muted}>({formatCount(item.n)}×)</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={styles.section} aria-labelledby="did">
        <SectionHead id="did" title="What they did" hint="Visits that did each thing; each thing counts once per visit." />
        <div className={styles.grid2}>
          <Counts
            title="Actions"
            rows={overview.actions.filter((a) => isAction(a.key)).map((a) => ({ label: ACTION_NAMES[a.key as keyof typeof ACTION_NAMES], n: a.n }))}
            total={overview.visits}
          />
          <Counts title="Units opened most" rows={overview.units.map((u) => ({ label: `Unit ${u.key}`, n: u.n }))} total={overview.visits} />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="who">
        <SectionHead id="who" title="Who they are" />
        <div className={styles.grid4}>
          <Counts title="Where they came from" rows={overview.sources.map((s) => ({ label: sourceName(s.key), n: s.n }))} total={overview.visits} />
          <Counts title="First page" rows={overview.entries.map((e) => ({ label: pageName(e.key), n: e.n }))} total={overview.visits} />
          <Counts title="Device" rows={overview.devices.map((d) => ({ label: deviceName(d.key), n: d.n }))} total={overview.visits} />
          <Counts title="Country" rows={overview.countries.map((c) => ({ label: countryName(c.key), n: c.n }))} total={overview.visits} />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="visits">
        <SectionHead id="visits" title="Visits" hint="Newest first. Times are GMT, which is Accra's time all year." />
        <nav aria-label="Which visits" className={styles.chips}>
          {VISIT_FILTERS.map((value) => (
            <Link
              key={value}
              href={hrefFor({ show: value, limit: PAGE_SIZE })}
              className={value === filter ? styles.chipActive : styles.chip}
              aria-current={value === filter ? "page" : undefined}
            >
              {FILTER_LABELS[value]}
              {value !== "all" && <span className={styles.share}>{formatCount(filterStories(stories, value).length)}</span>}
            </Link>
          ))}
        </nav>

        {page.length === 0 ? (
          <p className={styles.empty}>No visits in this time match that.</p>
        ) : (
          <ul className={styles.stories}>
            {page.map((story) => (
              <StoryCard key={story.id} story={story} today={today} />
            ))}
          </ul>
        )}
        {shown.length > page.length && (
          <div className={styles.more}>
            <Link href={hrefFor({ limit: limit + PAGE_SIZE })} className={styles.btn}>
              Show {Math.min(PAGE_SIZE, shown.length - page.length)} more
            </Link>
          </div>
        )}
      </section>
    </>
  );
}

function StoryCard({ story, today }: { story: VisitStory; today: boolean }) {
  const browser = browserName(story.browser);
  return (
    <li className={story.contacted ? styles.storyContacted : styles.story}>
      <div className={styles.storyTop}>
        <span className={styles.storyWhen}>{whenText(story.firstAt, today)}</span>
        <span className={styles.muted}>
          {countryName(story.country)} · {deviceName(story.device)}
          {browser ? ` · ${browser}` : ""}
        </span>
        {story.contacted && <span className={styles.tagGood}>Got in touch</span>}
        {story.flags > 0 && (
          <span className={styles.tagWarn}>
            ⚠ {story.flags} {story.flags === 1 ? "problem" : "problems"}
          </span>
        )}
        <span className={styles.storyLength}>
          {story.pages} {story.pages === 1 ? "page" : "pages"}
          {story.seconds != null && story.seconds >= 1 ? ` · ${durationText(story.seconds * 1000)}` : ""}
        </span>
      </div>
      <p className={styles.storyFrom}>{capital(arrivalPhrase(story.sourceKind, story.sourceLabel, story.campaign))}</p>

      {story.steps.length > 0 && (
        <ol className={styles.steps} aria-label="Pages, in order">
          {story.steps.map((step, index) => (
            <li key={`${index}-${step.path}`} className={styles.step}>
              {index > 0 && (
                <span className={styles.stepArrow} aria-hidden="true">
                  →
                </span>
              )}
              <span className={`${step.trouble.length > 0 ? styles.stepBoxTrouble : styles.stepBox} ${step.leftHere ? styles.stepLast : ""}`} title={step.path}>
                {step.name}
                {step.seconds != null && <span className={styles.stepTime}> {durationText(step.seconds * 1000)}</span>}
                {step.leftHere && <span className={styles.stepTime}> · left here</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      {(story.done.length > 0 || story.flags > 0) && (
        <ul className={styles.storyNotes}>
          {story.steps.flatMap((step, index) =>
            step.done.map((thing, at) => (
              <li key={`d${index}-${at}`} className={styles.noteGood}>
                ✓ {ACTION_NAMES[thing.action]}
                {thing.detail ? `: ${thing.detail}` : ""} <span className={styles.muted}>(on {step.name})</span>
              </li>
            ))
          )}
          {story.steps.flatMap((step, index) =>
            step.trouble.map((item, at) => (
              <li key={`t${index}-${at}`} className={styles.noteWarn}>
                ⚠ On {step.name}: {troubleText(item.kind, item.label, item.amount)}
              </li>
            ))
          )}
        </ul>
      )}
    </li>
  );
}

function capital(text: string): string {
  return text.length > 0 ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function whenText(iso: string, today: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return today ? time : `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}, ${time}`;
}
