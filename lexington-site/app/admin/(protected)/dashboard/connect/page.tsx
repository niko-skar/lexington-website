import Link from "next/link";
import { randomBytes } from "node:crypto";
import type { ReactNode } from "react";

import { CopyButton } from "@/components/dashboard/CopyButton";
import styles from "@/components/dashboard/Dashboard.module.css";
import { googleAdsScript } from "@/lib/ads/google";
import { readGoogleReport } from "@/lib/ads/googleStore";
import { LEXINGTON_AD_ACCOUNT, metaConfig } from "@/lib/ads/meta";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { SITE_URL } from "@/lib/seo";

export const metadata = {
  title: "Connect ad accounts | The Lexington",
};

// A new sample secret is drawn each time the page is opened.
export const dynamic = "force-dynamic";

function Section({ title, done, children }: { title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.panel}>
        <h2 className={styles.sectionTitle} style={{ fontSize: 22 }}>
          {title}
          {done !== undefined && <span className={done ? styles.connected : styles.notConnected}>{done ? "Connected" : "Not connected yet"}</span>}
        </h2>
        <div style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6 }}>{children}</div>
      </div>
    </section>
  );
}

const Code = ({ children }: { children: ReactNode }) => <code className={styles.code}>{children}</code>;

const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--clay)", textDecoration: "underline" }}>
    {children}
  </a>
);

function Value({ name, value }: { name: string; value: string }) {
  return (
    <div className={styles.valueBox}>
      <div className={styles.valueText}>
        <div className={styles.muted} style={{ fontFamily: "var(--font-sans)", fontSize: 12, marginBottom: 2 }}>
          Name: {name}
        </div>
        {value}
      </div>
      <CopyButton text={value} />
    </div>
  );
}

/**
 * How to connect the ad accounts, step by step and in plain words. Nothing here
 * changes anything: the settings are added by Niko in Vercel; this page only
 * says what and where. Admin only, because the Google Ads script on it carries
 * the secret that makes the report address answer.
 */
export default async function ConnectPage() {
  await requireAdminPage();

  const metaDone = metaConfig() !== null;
  const googleSecret = (process.env.GOOGLE_ADS_REPORT_SECRET ?? "").trim();
  const googleSet = googleSecret.length >= 16;
  const report = googleSet ? await readGoogleReport() : null;
  const sampleSecret = googleSet ? null : randomBytes(24).toString("base64url");
  const script = googleSet ? googleAdsScript({ endpoint: `${SITE_URL}/api/ads/google-report`, secret: googleSecret }) : null;

  return (
    <main className={styles.page} style={{ maxWidth: 860 }}>
      <p style={{ marginBottom: 14 }}>
        <Link href="/admin/dashboard" className={styles.toolLink}>
          ← Back to the dashboard
        </Link>
      </p>
      <h1 className={styles.title} style={{ marginBottom: 6 }}>
        Connect ad accounts
      </h1>
      <p className={styles.hint} style={{ marginBottom: 24 }}>
        The Visitors tab needs nothing: the website records its own visits. The Ads tab can also show what Meta and Google say
        your adverts spent and brought in, once each is connected below. They are separate; connect either, in any order.
      </p>

      <Section title="Where the settings go">
        <p>
          Each setting below is added in Vercel: open the <strong>lexington-website</strong> project, then <strong>Settings</strong>,
          then <strong>Environment Variables</strong>. Type the name, paste the value, tick <strong>Production</strong> (and
          Preview if you like), tick &ldquo;Sensitive&rdquo; and press Save.
        </p>
        <p style={{ marginTop: 8 }}>New settings work from the next deploy, so after adding one, tell me and I will redeploy.</p>
      </Section>

      <Section title="Meta ads (Facebook and Instagram)" done={metaDone}>
        <p>This gives the dashboard a key that can only read the ad account&rsquo;s results. It cannot change or spend anything.</p>
        <ol className={styles.steplist}>
          <li>
            Open <Ext href="https://business.facebook.com/settings/system-users">Business settings, Users, System users</Ext>. Check
            that the portfolio at the top left is <strong>The Lexington Apartments</strong>.
          </li>
          <li>
            Press <strong>Add</strong>, name it <Code>Lexington Dashboard</Code> and give it the role <strong>Employee</strong>.
          </li>
          <li>
            Press <strong>Assign assets</strong>, choose <strong>Ad accounts</strong>, pick <strong>Lexington</strong> (number{" "}
            <Code>{LEXINGTON_AD_ACCOUNT}</Code>) and switch on <strong>View performance</strong> only. Save.
          </li>
          <li>
            Press <strong>Generate new token</strong>, choose the app <strong>Lexington Publisher</strong>, set the expiry to{" "}
            <strong>Never</strong>, tick <Code>ads_read</Code> and press Generate. Copy the token.
            <span className={styles.sub}>
              If <Code>ads_read</Code> is not in the list: in developers.facebook.com open Lexington Publisher, then Use cases, and
              add &ldquo;Measure ad performance data with Marketing API&rdquo;. Then try again.
            </span>
          </li>
          <li>
            In Vercel, add it as <Code>META_ADS_ACCESS_TOKEN</Code> (see &ldquo;Where the settings go&rdquo;). The ad account&rsquo;s
            number is already built in.
          </li>
        </ol>
      </Section>

      <Section title="Google Ads" done={googleSet && !!report && report.rows.length > 0}>
        <p>
          Only needed if you run Google Ads for The Lexington. Google&rsquo;s own connection takes days of approval, so instead a
          small script runs inside your Google Ads account every hour and sends the spend and clicks here. It sends figures only,
          nothing about the people who clicked.
        </p>
        <ol className={styles.steplist}>
          <li>
            Add a secret that only the script and this website know, as <Code>GOOGLE_ADS_REPORT_SECRET</Code>
            {sampleSecret ? ". Use this one:" : " (done: it is in the script below)."}
            {sampleSecret && (
              <>
                <Value name="GOOGLE_ADS_REPORT_SECRET" value={sampleSecret} />
                <span className={styles.sub}>A new one appears each time this page opens. Use one, then reload after the redeploy.</span>
              </>
            )}
          </li>
          <li>After the redeploy, reload this page: the script appears below with the secret already in it.</li>
          <li>
            In Google Ads open <strong>Tools</strong>, <strong>Bulk actions</strong>, <strong>Scripts</strong>, press the plus and{" "}
            <strong>New script</strong>. Name it <Code>Lexington Dashboard</Code>, delete what is there and paste the script.
          </li>
          <li>
            Press <strong>Authorize</strong> (Google asks to let it send data out), then <strong>Run</strong> once, then{" "}
            <strong>Save</strong> and set the frequency to <strong>Hourly</strong>.
          </li>
        </ol>
        {script ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span className={styles.sub}>The script (it contains the secret: keep it to yourself)</span>
              <CopyButton text={script} label="Copy the script" />
            </div>
            <pre className={styles.script}>{script}</pre>
            {report?.receivedAt && (
              <p className={styles.sub}>Last report received: {new Date(report.receivedAt).toUTCString().slice(5, 22)} GMT</p>
            )}
          </div>
        ) : (
          <p className={styles.sub} style={{ marginTop: 10 }}>
            The script will appear here once the secret is set and deployed.
          </p>
        )}
      </Section>
    </main>
  );
}
