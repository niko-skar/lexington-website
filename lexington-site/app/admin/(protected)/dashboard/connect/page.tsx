import Link from "next/link";
import { randomBytes } from "node:crypto";
import type { ReactNode } from "react";

import { ConnectPageButton } from "@/components/dashboard/ConnectPageButton";
import { CopyButton } from "@/components/dashboard/CopyButton";
import styles from "@/components/dashboard/Dashboard.module.css";
import { PendingButton } from "@/components/dashboard/PendingButton";
import { TestClaudeButton } from "@/components/dashboard/TestClaudeButton";
import { setChatPausedAction } from "@/lib/actions/chat";
import { claudeConfigured } from "@/lib/ai/claude";
import { pilotSettings, readPilotRun } from "@/lib/agents/adsPilot";
import { chatAgentOn, chatSummary, readChatSwitch } from "@/lib/agents/chat";
import { usd } from "@/lib/agents/adsPilotCore";
import { autoReplyOn } from "@/lib/agents/leadReply";
import { metaLeadsConfigured, readMetaLeadsState } from "@/lib/agents/metaLeads";
import { GOOGLE_SCRIPT_VERSION, googleAdsScript } from "@/lib/ads/google";
import { readGoogleReport } from "@/lib/ads/googleStore";
import { LEXINGTON_AD_ACCOUNT, metaConfig } from "@/lib/ads/meta";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { formatWhen } from "@/lib/crm";
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
  const script = googleSet
    ? googleAdsScript({ endpoint: `${SITE_URL}/api/ads/google-report`, planEndpoint: `${SITE_URL}/api/ads/google-plan`, secret: googleSecret })
    : null;
  const claudeDone = claudeConfigured();
  const leadsState = await readMetaLeadsState();
  const leadsDone = Boolean(process.env.META_LEADS_TOKEN && leadsState?.lastOkAt && !leadsState.lastError);
  const pilot = pilotSettings();
  const pilotRun = await readPilotRun();
  const pilotDone = pilot.mode === "on" && Boolean(pilotRun?.plan) && !pilotRun?.errors.length;
  const [chats, chatSwitch] = await Promise.all([chatSummary().catch(() => null), readChatSwitch()]);
  const chatReady = Boolean(process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN);
  // Shown even once it is set: the same value goes into Facebook's webhook settings afterwards.
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || null;
  const sampleVerify = verifyToken ? null : randomBytes(18).toString("base64url");

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

      <Section title="Claude: the AI that writes" done={claudeDone}>
        <p>
          Claude writes the suggested first reply to each new enquiry, the words for your site updates, and the note on the
          daily ads check. It only uses the website&rsquo;s own facts, and every reply goes through a fact check before you
          see it. Without it everything still works, with a standard reply and your own words.
        </p>
        <ol className={styles.steplist}>
          <li>
            Open <Ext href="https://console.anthropic.com">console.anthropic.com</Ext> and sign in (or create the account
            yourself).
          </li>
          <li>
            Under <strong>Settings, Billing</strong>, add a card and some credit. Under <strong>Settings, Limits</strong>, set a
            monthly spend limit you are happy with (for example $20): it can never spend more.
          </li>
          <li>
            Under <strong>API keys</strong>, press <strong>Create key</strong>, name it <Code>Lexington website</Code> and copy it.
          </li>
          <li>
            In Vercel, add it as <Code>ANTHROPIC_API_KEY</Code> (see &ldquo;Where the settings go&rdquo;). After the redeploy,
            press &ldquo;Test it&rdquo; here.
          </li>
        </ol>
        <p className={styles.sub}>
          Expected cost: a few cents per reply or site update. It uses Claude Opus 5.5; if Claude&rsquo;s safety checks ever
          refuse an ordinary request by mistake, Anthropic answers it with its recommended stand-in model instead.
        </p>
        {claudeDone && <TestClaudeButton />}
      </Section>

      <Section title="Facebook / Instagram lead forms into the CRM" done={leadsDone}>
        <p>
          Every ten minutes the website looks for new entries on your Facebook lead forms. Each one goes into Prospects with a
          suggested first reply, and you get an alert in the site app (it buzzes your phone).
        </p>
        <p style={{ marginTop: 8 }}>
          {!metaLeadsConfigured()
            ? "Not set up on this copy of the site."
            : leadsState?.lastError
              ? `Last look${leadsState.lastRunAt ? ` (${formatWhen(leadsState.lastRunAt)} GMT)` : ""}: ${leadsState.lastError}`
              : leadsState?.lastOkAt
                ? `Last look: ${formatWhen(leadsState.lastOkAt)} GMT, ${leadsState.forms ?? 0} active form(s).`
                : "It hasn't looked yet."}
        </p>
        <p style={{ marginTop: 8 }}>
          The saved Facebook login (the one the daily posts use) isn&rsquo;t allowed to read lead forms. It needs its own key,
          from a &ldquo;system user&rdquo; in Business settings: it never expires and isn&rsquo;t tied to your password. The same
          key can also read your ad numbers (the Meta ads section below).
        </p>
        <ol className={styles.steplist}>
          <li>
            Open <Ext href="https://business.facebook.com/settings/system-users">Business settings, Users, System users</Ext> with{" "}
            <strong>The Lexington Apartments</strong> chosen at the top left. Press <strong>Add</strong>, name it{" "}
            <Code>Lexington Website</Code>, role <strong>Employee</strong>.
          </li>
          <li>
            <strong>Assign assets</strong>: the Page <strong>The Lexington Apartments</strong> with access to leads and ads, and the ad
            account <strong>Lexington</strong> with <strong>Manage campaigns</strong> (the ads autopilot changes budgets).
          </li>
          <li>
            <strong>Generate new token</strong>: app <strong>Lexington Publisher</strong>, expiry <strong>Never</strong>, and tick{" "}
            <Code>leads_retrieval</Code>, <Code>pages_manage_ads</Code>, <Code>pages_manage_metadata</Code>,{" "}
            <Code>pages_read_engagement</Code>, <Code>pages_show_list</Code>, <Code>ads_read</Code> and <Code>ads_management</Code>.
            Copy it.
          </li>
          <li>
            In Vercel, add it as <Code>META_LEADS_TOKEN</Code>, and the same key again as <Code>META_ADS_ACCESS_TOKEN</Code> for the
            ad numbers.
          </li>
        </ol>
      </Section>

      <Section title="Automatic replies">
        <p>
          {autoReplyOn()
            ? "ON: a suggested reply that passes the fact check is emailed to the person straight away, without waiting for you."
            : "OFF: every suggested reply waits for you to read it and press Send."}
        </p>
        <p style={{ marginTop: 8 }}>
          To switch it on, add <Code>LEAD_AUTO_REPLY</Code> with the value <Code>1</Code> in Vercel; delete it to switch it off.
          It never sends a reply the fact check flagged, a standard (non-Claude) reply, or one to someone who looks like spam.
          Worth trying for a few weeks with it off first.
        </p>
      </Section>

      <Section title="Messages: Messenger, Instagram and WhatsApp" done={chatReady && Boolean(chats?.lastAt)}>
        <p>
          The Lexington&rsquo;s assistant answers the messages people send the Page on Messenger and Instagram (and WhatsApp
          once it&rsquo;s connected), from the website&rsquo;s facts only, with the same fact check as the email replies. It
          hands a chat to you, with an alert in the site app and a step in Prospects, when someone wants a viewing or a call, asks how to pay,
          wants a better price, has a legal question, is unhappy, asks for a person, or asks something the website doesn&rsquo;t
          answer. When you answer a chat yourself it stays quiet there for {12} hours. Its first message says it is the
          assistant (Meta&rsquo;s rule for automatic replies). Every chat is in Prospects.
        </p>
        <p style={{ marginTop: 8 }}>
          {!chatAgentOn()
            ? "Switched off (CHAT_AGENT=off in Vercel)."
            : chatSwitch.paused
              ? "Paused by you: every message waits for you, and you get an alert for each chat."
              : chats?.lastAt
                ? `On. Last message ${formatWhen(chats.lastAt)} GMT; ${chats.active} chat${chats.active === 1 ? "" : "s"} in the last day${chats.waiting.length ? `; ${chats.waiting.length} waiting for you` : ""}.`
                : "On, waiting for its first message."}
        </p>
        {chatAgentOn() && (
          <form action={setChatPausedAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="paused" value={chatSwitch.paused ? "0" : "1"} />
            <PendingButton label={chatSwitch.paused ? "Resume the assistant" : "Pause the assistant"} pendingLabel="Saving…" />
          </form>
        )}
        <ol className={styles.steplist}>
          <li>
            The Facebook key (the one in <Code>META_LEADS_TOKEN</Code>) also needs <Code>pages_messaging</Code>,{" "}
            <Code>instagram_basic</Code> and <Code>instagram_manage_messages</Code> ticked. Same steps as before in the Graph API
            Explorer.
          </li>
          <li>
            In Vercel add <Code>META_APP_SECRET</Code>: in{" "}
            <Ext href="https://developers.facebook.com/apps">developers.facebook.com</Ext>, open Lexington Publisher, then App
            settings, Basic, and press Show next to App secret. Copy it.
          </li>
          <li>
            In Vercel add <Code>META_WEBHOOK_VERIFY_TOKEN</Code>
            {verifyToken ? ": set. The same value goes into Facebook in the next step:" : ". Use this one:"}
            <Value name="META_WEBHOOK_VERIFY_TOKEN" value={verifyToken ?? sampleVerify ?? ""} />
            {sampleVerify && <span className={styles.sub}>A new one appears each time this page opens. Use one, and keep it.</span>}
          </li>
          <li>
            After the redeploy, in Lexington Publisher open Use cases, add <strong>Engage with customers on Messenger from Meta</strong>
            , and under its webhooks enter the callback address <Code>{`${SITE_URL}/api/meta/webhook`}</Code> and the same verify
            token, then Verify and save. Tick the fields <Code>messages</Code>, <Code>message_echoes</Code> and{" "}
            <Code>messaging_postbacks</Code>. For Instagram, add the Instagram messaging use case and tick <Code>messages</Code>{" "}
            there too.
          </li>
          <li>
            On your phone, in Instagram: Settings, Messages, Connected tools, switch on <strong>Allow access to messages</strong>.
          </li>
          <li>
            Press <strong>Connect the Page</strong> below, then send the Page a message from another account to try it.
            <ConnectPageButton />
          </li>
        </ol>
        <p className={styles.sub}>
          WhatsApp: your number stays on the WhatsApp Business app on your phone and the assistant answers alongside you.
          Meta only lets its WhatsApp partners connect a number that way, so it needs one partner account (a one-time step,
          about 10 minutes, a code confirmed in the app). Then <Code>WHATSAPP_PHONE_NUMBER_ID</Code> and{" "}
          <Code>WHATSAPP_TOKEN</Code> go in Vercel.
        </p>
      </Section>

      <Section title="Meta ads (Facebook and Instagram)" done={metaDone}>
        <p>
          This gives the dashboard a key for the ad account. With <Code>ads_read</Code> it reads the results; with{" "}
          <Code>ads_management</Code> the ads autopilot can also change budgets and pause adverts (it never writes, edits or
          extends an advert).
        </p>
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
            <Code>{LEXINGTON_AD_ACCOUNT}</Code>) and switch on <strong>Manage campaigns</strong>. Save.
          </li>
          <li>
            Press <strong>Generate new token</strong>, choose the app <strong>Lexington Publisher</strong>, set the expiry to{" "}
            <strong>Never</strong>, tick <Code>ads_read</Code> and <Code>ads_management</Code> and press Generate. Copy the token.
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

      <Section title="Ads autopilot and ads manager" done={pilotDone}>
        <p>
          Every morning the ads manager (5:30) looks after the ads themselves: it writes and publishes new ads from the
          website&rsquo;s facts only, with pictures from the website and the site updates, tries one new idea a week in each ad
          set, switches off ads that bring no real enquiries (and any quoting an offer that has ended, the same night), and has
          tried the UK and Canada once each. Then the autopilot (6:00) keeps all the advertising within {usd(pilot.monthlyCap)}{" "}
          a month: what is left of the month is spread over the days left, and the money moves to where real enquiries come
          from. Every change, with the reason, is on the dashboard and in the daily ads check.
        </p>
        <ul className={styles.steplist}>
          <li>
            It needs the Meta key above with <Code>ads_management</Code> and <Code>pages_manage_ads</Code>, and for Google the
            script below (version {GOOGLE_SCRIPT_VERSION}).
          </li>
          <li>
            As a safety net, Facebook&rsquo;s own account spending limit is set to the month&rsquo;s budget on the 1st: Facebook
            stops by itself once it is spent, even if everything else failed.
          </li>
          <li>
            Optional settings in Vercel: <Code>ADS_MONTHLY_BUDGET</Code> (dollars a month; {usd(pilot.monthlyCap)} now) and{" "}
            <Code>ADS_PILOT</Code> set to <Code>off</Code> to switch it off completely. To stop it for a while, use Pause on the
            dashboard.
          </li>
        </ul>
        {pilotRun?.errors.length ? <p className={styles.sub}>Last run: {pilotRun.errors.join(" · ")}</p> : null}
      </Section>

      <Section title="Google Ads" done={googleSet && !!report && report.rows.length > 0}>
        <p>
          Only needed if you run Google Ads for The Lexington. Google&rsquo;s own connection takes days of approval, so instead a
          small script runs inside your Google Ads account every hour and sends the spend and clicks here, and makes the ads
          autopilot&rsquo;s budget changes. It sends figures only, nothing about the people who clicked.
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
              <p className={styles.sub}>
                Last report received: {new Date(report.receivedAt).toUTCString().slice(5, 22)} GMT
                {report.version < GOOGLE_SCRIPT_VERSION
                  ? ". The script in Google Ads is the older one: replace it with this one so the autopilot can set Google's budgets."
                  : "."}
              </p>
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
