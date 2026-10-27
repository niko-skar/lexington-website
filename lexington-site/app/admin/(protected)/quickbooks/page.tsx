import Link from "next/link";

import crm from "@/components/crm/Crm.module.css";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { qboKeys } from "@/lib/quickbooks/config";
import { loadConnection, recentLog, type QboLogLine } from "@/lib/quickbooks/store";

export const metadata = {
  title: "QuickBooks | The Lexington",
};

const OK_TEXT: Record<string, string> = {
  connected: "QuickBooks is connected.",
  tested: "The test worked: see the first line of the log below.",
  disconnected: "QuickBooks is disconnected. The website can no longer read or write the books.",
};

const ERR_TEXT: Record<string, string> = {
  keys: "The website has no QuickBooks keys yet (QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET).",
  denied: "The QuickBooks sign-in was cancelled, so nothing was connected.",
  state: "That sign-in answer did not come from this browser's request, so it was refused. Please press Connect again.",
  signin: "QuickBooks did not complete the sign-in. The log below says why.",
  test: "The test failed. The log below says why.",
  disconnect: "Disconnecting failed. Please try again.",
  origin: "That button press did not come from this page, so it was refused.",
};

const ACTION_TEXT: Record<QboLogLine["action"], string> = {
  connect: "Sign-in started",
  callback: "Sign-in",
  refresh: "Login renewed",
  api: "Books request",
  test: "Test",
  disconnect: "Disconnect",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });

/**
 * The website's link to QuickBooks Online (Niko, 27 Oct 2026): connect once, and the site app can
 * put expenses into the books. Only an admin login opens this page.
 */
export default async function QuickBooksPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireAdminPage();
  const { ok, err } = await searchParams;
  const keys = qboKeys();
  const [conn, log] = await Promise.all([loadConnection(), recentLog(25)]);

  return (
    <main className={crm.crmPage}>
      <h1 className={crm.prospectTitle}>QuickBooks</h1>
      <p className={crm.sectionHint} style={{ marginBottom: 20, maxWidth: "62ch" }}>
        The website&rsquo;s own connection to The Lexington&rsquo;s QuickBooks Online books, through our private Intuit app
        &ldquo;Lexington Books&rdquo;. It only reads and adds accounting entries; it never deletes anything. Only the person who
        connects it, signed in here as an admin, can use it.
      </p>

      {ok && OK_TEXT[ok] && <p className={crm.formMsgOk}>{OK_TEXT[ok]}</p>}
      {err && ERR_TEXT[err] && <p className={crm.formMsgErr}>{ERR_TEXT[err]}</p>}

      <section className={crm.panel}>
        <h2 className={crm.panelTitle}>Connection</h2>
        {!keys ? (
          <p className={crm.sectionHint}>{ERR_TEXT.keys}</p>
        ) : !conn ? (
          <>
            <p>
              Not connected. Press the button, sign in to QuickBooks and choose the company.
              {keys.environment === "sandbox" && " (These are practice keys: only an Intuit practice company can be chosen.)"}
            </p>
            <div className={crm.actions}>
              <a className={`${crm.btn} ${crm.btnPrimary}`} href="/api/quickbooks/connect">
                Connect QuickBooks
              </a>
            </div>
          </>
        ) : (
          <>
            <p>
              {conn.status === "reconnect" ? (
                <strong>Needs you to sign in again. </strong>
              ) : (
                <strong>Connected </strong>
              )}
              to {conn.companyName ?? "the company"}
              {conn.country ? ` (${conn.country})` : ""}, {conn.environment === "sandbox" ? "a practice company" : "the real books"}, since{" "}
              {when(conn.connectedAt)}.
              {conn.lastRefreshAt && ` Login last renewed ${when(conn.lastRefreshAt)}.`} The saved login lasts until{" "}
              {when(conn.refreshExpiresAt)} and renews itself whenever it is used.
            </p>
            {conn.problem && <p className={crm.formMsgErr}>{conn.problem}</p>}
            <div className={crm.actions}>
              {conn.status === "reconnect" ? (
                <a className={`${crm.btn} ${crm.btnPrimary}`} href="/api/quickbooks/connect">
                  Sign in again
                </a>
              ) : (
                <form method="post" action="/api/quickbooks/test">
                  <button className={`${crm.btn} ${crm.btnPrimary}`} type="submit">
                    Test the connection
                  </button>
                </form>
              )}
              <form method="post" action="/api/quickbooks/disconnect">
                <button className={`${crm.btn} ${crm.btnDanger}`} type="submit">
                  Disconnect
                </button>
              </form>
            </div>
          </>
        )}
      </section>

      <section className={crm.panel}>
        <h2 className={crm.panelTitle}>Log</h2>
        <p className={crm.sectionHint}>
          Every sign-in, renewal, test and failed request. &ldquo;Intuit ref&rdquo; is Intuit&rsquo;s own number for a request: quote it
          to Intuit support if something goes wrong.
        </p>
        {log.length === 0 ? (
          <p className={crm.sectionHint}>Nothing yet.</p>
        ) : (
          <ul className={crm.noteList}>
            {log.map((line) => (
              <li key={line.id} className={crm.noteItem}>
                <div className={crm.noteMeta}>
                  {when(line.at)} · {ACTION_TEXT[line.action] ?? line.action} · {line.ok ? "OK" : "Failed"}
                  {line.httpStatus ? ` · HTTP ${line.httpStatus}` : ""}
                  {line.intuitTid ? ` · Intuit ref ${line.intuitTid}` : ""}
                </div>
                <div>{line.message}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className={crm.sectionHint} style={{ marginTop: 24 }}>
        Help with this page: <Link href="/contact">contact The Lexington office</Link>. Terms: <Link href="/terms">Terms of Use</Link>
        {" · "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </main>
  );
}
