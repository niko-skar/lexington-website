import Link from "next/link";

import type { GoogleSummary } from "@/lib/ads/google";
import { statusName, type MetaResult } from "@/lib/ads/meta";
import { AD_KINDS, durationText, sourceName } from "@/lib/visits/rules";
import { percent, type SourceLine } from "@/lib/visits/report";

import styles from "./Dashboard.module.css";
import { DayColumns, HBars, SectionHead, Tiles, formatCount, formatMoney, formatShare, shortDay } from "./parts";

export interface MetaState {
  connected: boolean;
  result: MetaResult | null;
}

export interface GoogleState {
  connected: boolean;
  summary: GoogleSummary | null;
  receivedAt: string | null;
  error: string | null;
}

/**
 * How the adverts are doing: what Meta (and Google, once connected) say they
 * spent and brought in, and what the people who came to the website from each
 * source went on to do there.
 */
export function AdsView({
  meta,
  google,
  lines,
  visitsError,
}: {
  meta: MetaState;
  google: GoogleState;
  lines: SourceLine[];
  visitsError: string | null;
}) {
  const report = meta.result?.ok ? meta.result.report : null;
  const googleHasRows = !!google.summary && google.summary.campaigns.length > 0;
  const adLines = lines.filter((line) => (AD_KINDS as readonly string[]).includes(line.kind));
  const adVisits = adLines.reduce((sum, line) => sum + line.visits, 0);
  const adContacted = adLines.reduce((sum, line) => sum + line.contacted, 0);

  const currency = report?.currency ?? google.summary?.currency ?? "USD";
  const sameCurrency = !report || !googleHasRows || report.currency === google.summary?.currency;
  const spend = (report?.totals.spend ?? 0) + (googleHasRows && sameCurrency ? (google.summary?.totals.spend ?? 0) : 0);

  return (
    <>
      <Tiles
        tiles={[
          {
            label: "Spent on ads",
            value: report || googleHasRows ? formatMoney(spend, currency) : "—",
            hint: report || googleHasRows ? [report && "Meta", googleHasRows && "Google"].filter(Boolean).join(" + ") : "connect Meta to see this",
          },
          {
            label: "Leads from Meta",
            value: report ? formatCount(report.totals.leads) : "—",
            hint: report ? `${formatCount(report.totals.form)} from the form, ${formatCount(report.totals.site)} from the website` : "connect Meta to see this",
          },
          {
            label: "Cost per lead",
            value: report?.totals.costPerLead != null ? formatMoney(report.totals.costPerLead, report.currency) : "—",
            hint: "Meta's spend divided by its leads",
          },
          { label: "Website visits from ads", value: formatCount(adVisits), hint: "counted by the website itself" },
          {
            label: "Got in touch after an ad",
            value: formatCount(adContacted),
            hint: adVisits > 0 ? `${percent(adContacted, adVisits)}% of ad visits` : "enquiry, WhatsApp, call or email",
          },
        ]}
      />

      <section className={styles.section} aria-labelledby="meta">
        <SectionHead id="meta" title="Meta ads (Facebook and Instagram)" />
        {!meta.connected ? (
          <div className={styles.notice}>
            <p>
              <strong>Not connected yet.</strong> To show spend, leads and cost per lead here, Meta needs a read-only key for the
              Lexington ad account. It takes about five minutes in Meta&rsquo;s Business settings.
            </p>
            <p>
              <Link href="/admin/dashboard/connect" className={styles.btnPrimary}>
                Show me how
              </Link>
            </p>
          </div>
        ) : !report ? (
          <div className={styles.error}>
            <p>
              <strong>Meta did not answer:</strong> {meta.result && !meta.result.ok ? meta.result.error : "no answer"}
            </p>
            <p>
              If it says the key is not allowed, check the steps on <Link href="/admin/dashboard/connect">the connect page</Link>.
            </p>
          </div>
        ) : (
          <MetaReportView report={report} />
        )}
      </section>

      <section className={styles.section} aria-labelledby="google">
        <SectionHead id="google" title="Google Ads" />
        {googleHasRows && google.summary ? (
          <GoogleView summary={google.summary} receivedAt={google.receivedAt} />
        ) : (
          <div className={styles.notice}>
            <p>
              {google.connected
                ? "Waiting for the first report from the script in Google Ads. It sends one every hour once it is pasted in and authorised."
                : "Not connected. If you run Google Ads for The Lexington, a small script in your Google Ads account can send its spend and clicks here every hour."}
            </p>
            {google.error && <p className={styles.muted}>({google.error})</p>}
            <p>
              <Link href="/admin/dashboard/connect" className={styles.btn}>
                How to connect Google Ads
              </Link>
            </p>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="site">
        <SectionHead
          id="site"
          title="What visitors from each source did on the website"
          hint="From the website's own visit record, so it counts everyone, whatever their cookie settings. Each thing counts once per visit."
        />
        {visitsError ? (
          <p className={styles.error}>The visits could not be read just now ({visitsError}).</p>
        ) : lines.length === 0 ? (
          <p className={styles.empty}>No visits in this time yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.tableWide}>
              <thead>
                <tr>
                  <th scope="col">Where from</th>
                  <th scope="col" className={styles.num}>Visits</th>
                  <th scope="col" className={styles.num}>Left after one page</th>
                  <th scope="col" className={styles.num}>Time on site</th>
                  <th scope="col" className={styles.num}>Opened a unit</th>
                  <th scope="col" className={styles.num}>Got in touch</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <th scope="row">
                      {sourceName(line.kind)}
                      {(line.campaign || line.label) && (
                        <span className={styles.sub}>{[line.label, line.campaign].filter(Boolean).join(" · ")}</span>
                      )}
                    </th>
                    <td className={styles.num}>{formatCount(line.visits)}</td>
                    <td className={styles.num}>{percent(line.onePage, line.visits)}%</td>
                    <td className={styles.num}>{line.medianSeconds != null ? durationText(line.medianSeconds * 1000) : "—"}</td>
                    <td className={styles.num}>{formatCount(line.units)}</td>
                    <td className={styles.num}>
                      {formatCount(line.contacted)}
                      {line.contacted > 0 && <span className={styles.share}>{percent(line.contacted, line.visits)}%</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.hint} style={{ marginTop: 10 }}>
          Meta&rsquo;s lead-form adverts keep people inside Facebook and Instagram, so their leads show above, not here. An
          advert&rsquo;s visits are recognised by its link: Meta&rsquo;s own click tag, or{" "}
          <code className={styles.code}>utm_medium=paid_social</code> in the advert&rsquo;s URL parameters.
        </p>
      </section>
    </>
  );
}

/** "1 lead", "3 leads". */
function plural(n: number, word: string): string {
  return `${formatCount(n)} ${n === 1 ? word : `${word}s`}`;
}

function MetaReportView({ report }: { report: Extract<MetaResult, { ok: true }>["report"] }) {
  const money = (n: number) => formatMoney(n, report.currency);
  const running = report.campaigns.filter((c) => c.status === "ACTIVE" || report.ads.some((ad) => ad.campaign === c.name && ad.spend > 0));
  const quiet = report.campaigns.length - running.length;
  return (
    <>
      {report.partial.length > 0 && (
        <p className={styles.notice} style={{ marginBottom: 16 }}>
          Some parts could not be read: {report.partial.join("; ")}
        </p>
      )}

      <div className={styles.grid2} style={{ marginBottom: 24 }}>
        <DayColumns
          title="Spent each day"
          total={`${money(report.totals.spend)} in all`}
          points={report.byDay.map((day) => ({ day: day.day, value: day.spend, note: day.leads ? plural(day.leads, "lead") : undefined }))}
          format={money}
          integer={false}
        />
        <DayColumns
          title="Leads each day"
          total={`${formatCount(report.totals.leads)} in all`}
          points={report.byDay.map((day) => ({ day: day.day, value: day.leads, note: `${money(day.spend)} spent` }))}
          format={formatCount}
        />
      </div>

      <div className={styles.grid2} style={{ marginBottom: 24 }}>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Reach</h3>
          <p>
            <strong>{report.totals.reach != null ? formatCount(report.totals.reach) : "—"}</strong> people saw an advert{" "}
            <span className={styles.muted}>({formatCount(report.totals.impressions)} times in all)</span>
          </p>
          <p style={{ marginTop: 6 }}>
            <strong>{formatCount(report.totals.linkClicks)}</strong> link taps{" "}
            <span className={styles.muted}>({formatShare(report.totals.ctr)} of views)</span>
          </p>
        </div>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Campaigns</h3>
          {running.length === 0 ? (
            <p className={styles.muted}>No campaign is running.</p>
          ) : (
            <ul className={styles.counts}>
              {running.map((campaign) => (
                <li key={campaign.id} className={styles.countRow}>
                  <span className={styles.countLabel} title={campaign.name}>
                    {campaign.name}
                  </span>
                  <span className={campaign.status === "ACTIVE" ? styles.statusOn : styles.statusOff}>{statusName(campaign.status)}</span>
                  <span className={styles.sub} style={{ gridColumn: "1 / -1" }}>
                    {campaign.dailyBudget != null ? `${money(campaign.dailyBudget)} a day` : campaign.lifetimeBudget != null ? `${money(campaign.lifetimeBudget)} in all` : "Budget set per ad set"}
                    {campaign.stopTime ? ` · ends ${shortDay(campaign.stopTime.slice(0, 10))}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {quiet > 0 && <p className={styles.sub}>{quiet} more switched off.</p>}
        </div>
      </div>

      <h3 className={styles.panelTitle}>Each advert</h3>
      {report.ads.length === 0 ? (
        <p className={styles.empty}>No advert spent anything in this time.</p>
      ) : (
        <div className={styles.tableWrap} style={{ marginBottom: 24 }}>
          <table className={styles.tableWide}>
            <thead>
              <tr>
                <th scope="col">Advert</th>
                <th scope="col" className={styles.num}>Spent</th>
                <th scope="col" className={styles.num}>People</th>
                <th scope="col" className={styles.num}>Link taps</th>
                <th scope="col" className={styles.num}>Leads</th>
                <th scope="col" className={styles.num}>Per lead</th>
              </tr>
            </thead>
            <tbody>
              {report.ads.map((ad) => (
                <tr key={ad.id || ad.ad}>
                  <th scope="row">
                    {ad.ad}
                    <span className={styles.sub}>{[ad.campaign, ad.adset].filter(Boolean).join(" · ")}</span>
                  </th>
                  <td className={styles.num}>{money(ad.spend)}</td>
                  <td className={styles.num}>{ad.reach != null ? formatCount(ad.reach) : "—"}</td>
                  <td className={styles.num}>{formatCount(ad.linkClicks)}</td>
                  <td className={styles.num}>{formatCount(ad.leads)}</td>
                  <td className={styles.num}>{ad.costPerLead != null ? money(ad.costPerLead) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.grid2}>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Leads by age</h3>
          {report.byAge.length === 0 ? (
            <p className={styles.muted}>—</p>
          ) : (
            <HBars
              label="Leads by age"
              rows={report.byAge.map((slice) => ({
                key: slice.key,
                label: slice.label,
                value: slice.leads,
                valueText: `${formatCount(slice.leads)}${slice.costPerLead != null ? ` · ${money(slice.costPerLead)} each` : ""}`,
              }))}
            />
          )}
        </div>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Leads by where the advert showed</h3>
          {report.byPlacement.length === 0 ? (
            <p className={styles.muted}>—</p>
          ) : (
            <HBars
              label="Leads by placement"
              rows={report.byPlacement.slice(0, 8).map((slice) => ({
                key: slice.key,
                label: slice.label,
                value: slice.leads,
                valueText: `${formatCount(slice.leads)} · ${money(slice.spend)}`,
              }))}
            />
          )}
        </div>
      </div>
    </>
  );
}

function GoogleView({ summary, receivedAt }: { summary: GoogleSummary; receivedAt: string | null }) {
  const money = (n: number) => formatMoney(n, summary.currency);
  return (
    <>
      <div className={styles.grid2} style={{ marginBottom: 16 }}>
        <DayColumns
          title="Spent each day"
          total={`${money(summary.totals.spend)} in all`}
          points={summary.byDay.map((day) => ({ day: day.day, value: day.spend, note: plural(day.clicks, "click") }))}
          format={money}
          integer={false}
        />
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>In this time</h3>
          <p>
            <strong>{formatCount(summary.totals.clicks)}</strong> clicks <span className={styles.muted}>({formatShare(summary.totals.ctr)} of views)</span>
          </p>
          <p style={{ marginTop: 6 }}>
            <strong>{summary.totals.cpc != null ? money(summary.totals.cpc) : "—"}</strong> a click
          </p>
          <p style={{ marginTop: 6 }}>
            <strong>{summary.totals.conversions != null ? formatCount(summary.totals.conversions) : "—"}</strong>{" "}
            {summary.totals.conversions === 1 ? "conversion" : "conversions"} <span className={styles.muted}>(as Google Ads counts them)</span>
          </p>
          {receivedAt && <p className={styles.sub}>Last report from Google: {new Date(receivedAt).toUTCString().slice(5, 22)} GMT</p>}
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.tableWide}>
          <thead>
            <tr>
              <th scope="col">Campaign</th>
              <th scope="col" className={styles.num}>Spent</th>
              <th scope="col" className={styles.num}>Clicks</th>
              <th scope="col" className={styles.num}>Per click</th>
              <th scope="col" className={styles.num}>Conversions</th>
            </tr>
          </thead>
          <tbody>
            {summary.campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <th scope="row">{campaign.name}</th>
                <td className={styles.num}>{money(campaign.spend)}</td>
                <td className={styles.num}>{formatCount(campaign.clicks)}</td>
                <td className={styles.num}>{campaign.cpc != null ? money(campaign.cpc) : "—"}</td>
                <td className={styles.num}>{campaign.conversions != null ? formatCount(campaign.conversions) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
