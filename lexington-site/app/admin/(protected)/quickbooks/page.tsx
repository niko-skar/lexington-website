import Link from "next/link";

import crm from "@/components/crm/Crm.module.css";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { CATEGORIES, METHODS, money, todayISO } from "@/lib/expenses/shared";
import { qboKeys } from "@/lib/quickbooks/config";
import { feedStatus, PAY_TYPES, qboLists, suggestSettings, type FeedRow, type FeedStatus, type QboLists } from "@/lib/quickbooks/feed";
import { classField, payField, RULE_ROWS } from "@/lib/quickbooks/feedForm";
import { loadConnection, recentLog, type QboConnection, type QboLogLine } from "@/lib/quickbooks/store";

export const metadata = {
  title: "QuickBooks | The Lexington",
};

// "Send now" can take a few minutes with a long list.
export const maxDuration = 300;

const OK_TEXT: Record<string, string> = {
  connected: "QuickBooks is connected.",
  tested: "The test worked: see the first line of the log below.",
  disconnected: "QuickBooks is disconnected. The website can no longer read or write the books.",
  saved: "Saved. Nothing was sent: saving only sets where entries will go.",
  on: "The expenses feed is on. Site entries from the start date go to QuickBooks as they are saved.",
  off: "The expenses feed is off. Nothing more goes to QuickBooks until you switch it on again.",
  done: "Taken off the list.",
};

const ERR_TEXT: Record<string, string> = {
  keys: "The website has no QuickBooks keys yet (QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET).",
  denied: "The QuickBooks sign-in was cancelled, so nothing was connected.",
  state: "That sign-in answer did not come from this browser's request, so it was refused. Please press Connect again.",
  signin: "QuickBooks did not complete the sign-in. The log below says why.",
  test: "The test failed. The log below says why.",
  disconnect: "Disconnecting failed. Please try again.",
  origin: "That button press did not come from this page, so it was refused.",
  feed: "That didn't work. The log below says why.",
  "feed-incomplete": "Choose the start date, the cost account and at least one account for \"Paid by\", and save, before switching on.",
  "feed-date": "Pick a start date.",
  "feed-account": "One of the chosen accounts isn't in QuickBooks any more (or is the wrong kind). Choose again and save.",
  "feed-company": "The settings were made for a different QuickBooks company, or QuickBooks isn't connected. Check the settings and save them again.",
};

const ACTION_TEXT: Record<QboLogLine["action"], string> = {
  connect: "Sign-in started",
  callback: "Sign-in",
  refresh: "Login renewed",
  api: "Books request",
  test: "Test",
  disconnect: "Disconnect",
  feed: "Expenses feed",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The website's link to QuickBooks Online (Niko, 27 Oct 2026): connect once, and the site app
 * puts expenses into the books. Only an admin login opens this page.
 */
export default async function QuickBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; n?: string; f?: string; w?: string }>;
}) {
  await requireAdminPage();
  const { ok, err, n, f, w } = await searchParams;
  const keys = qboKeys();
  const [conn, log] = await Promise.all([loadConnection(), recentLog(25)]);
  const sentText =
    ok === "sent" ? `Sent ${n ?? 0} to QuickBooks${Number(f) ? `, ${f} failed (see below)` : ""}${Number(w) > Number(n) ? `. More are waiting: press again.` : "."}` : null;

  return (
    <main className={crm.crmPage}>
      <h1 className={crm.prospectTitle}>QuickBooks</h1>
      <p className={crm.sectionHint} style={{ marginBottom: 20, maxWidth: "62ch" }}>
        The website&rsquo;s own connection to The Lexington&rsquo;s QuickBooks Online books, through our private Intuit app
        &ldquo;Lexington Books&rdquo;. It only reads and adds accounting entries; it never deletes anything. Only the person who
        connects it, signed in here as an admin, can use it.
      </p>

      {ok && (sentText ?? OK_TEXT[ok]) && <p className={crm.formMsgOk}>{sentText ?? OK_TEXT[ok]}</p>}
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
              {conn.status === "reconnect" ? <strong>Needs you to sign in again. </strong> : <strong>Connected </strong>}
              to {conn.companyName ?? "the company"}
              {conn.country ? ` (${conn.country})` : ""}, {conn.environment === "sandbox" ? "a practice company" : "the real books"}, since{" "}
              {when(conn.connectedAt)}.
              {conn.lastRefreshAt && ` Login last renewed ${when(conn.lastRefreshAt)}.`} The saved login lasts until {when(conn.refreshExpiresAt)}{" "}
              and renews itself whenever it is used.
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

      {keys && conn && conn.status === "connected" && <FeedPanel conn={conn} />}

      <section className={crm.panel}>
        <h2 className={crm.panelTitle}>Log</h2>
        <p className={crm.sectionHint}>
          Every sign-in, renewal, test, entry sent and failed request. &ldquo;Intuit ref&rdquo; is Intuit&rsquo;s own number for a request:
          quote it to Intuit support if something goes wrong.
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

/* ---------- the expenses feed ---------- */

async function FeedPanel({ conn }: { conn: QboConnection }) {
  let lists: QboLists;
  let status: FeedStatus;
  try {
    lists = await qboLists();
    status = await feedStatus(lists, conn);
  } catch (error) {
    return (
      <section className={crm.panel} id="feed">
        <h2 className={crm.panelTitle}>Expenses into QuickBooks</h2>
        <p className={crm.formMsgErr}>QuickBooks didn&rsquo;t answer just now ({error instanceof Error ? error.message : "no answer"}). Reload the page.</p>
      </section>
    );
  }
  const s = status.settings;
  const guess = suggestSettings(lists);
  const saved = !!s.updatedAt && s.realmId === conn.realmId;
  const pick = <T,>(value: T | null, suggestion: T | null) => (saved ? value : (value ?? suggestion));
  const payAccounts = lists.accounts.filter((a) => PAY_TYPES.includes(a.type));
  const otherAccounts = lists.accounts.filter((a) => !PAY_TYPES.includes(a.type));
  const rules = saved ? s.inflowRules : s.inflowRules.length ? s.inflowRules : guess.inflowRules;

  return (
    <section className={crm.panel} id="feed">
      <h2 className={crm.panelTitle}>
        Expenses into QuickBooks · <span>{s.enabled ? "ON" : "OFF"}</span>
      </h2>
      <p className={crm.sectionHint} style={{ maxWidth: "70ch" }}>
        Every <b>Site</b> and <b>Event</b> entry in the <Link href="/todo/expenses">expense app</Link> dated on or after the start date
        goes into QuickBooks as it is saved, with its receipt photo: an expense as an Expense paid from the account for how it was paid,
        money in as a Deposit. House and Niko entries never go. A change in the app updates the entry in QuickBooks; nothing is ever
        deleted there.
        {status.lastSentAt && ` Last sent ${when(status.lastSentAt)}.`}{" "}
        {status.sent > 0 && (status.sent === 1 ? "1 entry is in QuickBooks." : `${status.sent} entries are in QuickBooks.`)}
      </p>

      <div className={crm.actions} style={{ marginBottom: 16 }}>
        {s.enabled ? (
          <>
            <form method="post" action="/api/quickbooks/feed">
              <input type="hidden" name="action" value="send" />
              <button className={`${crm.btn} ${crm.btnPrimary}`} type="submit" disabled={status.waiting.length + status.failed.length === 0}>
                Send waiting entries now
              </button>
            </form>
            <form method="post" action="/api/quickbooks/feed">
              <input type="hidden" name="action" value="off" />
              <button className={crm.btn} type="submit">
                Switch off
              </button>
            </form>
          </>
        ) : (
          <form method="post" action="/api/quickbooks/feed">
            <input type="hidden" name="action" value="on" />
            <button className={`${crm.btn} ${crm.btnPrimary}`} type="submit" disabled={!saved}>
              Switch the feed on
            </button>
          </form>
        )}
      </div>
      {!saved && <p className={crm.sectionHint}>Check the choices below and press Save first; the feed can be switched on after that.</p>}

      <Rows title={s.enabled ? "Waiting to go" : "Would go when you switch on"} rows={status.waiting} empty="Nothing waiting." />
      {status.needsYou.length > 0 && <Rows title="Waiting for a choice from you" rows={status.needsYou} />}
      {status.failed.length > 0 && (
        <>
          <h3 className={crm.sectionTitle} style={SUBHEAD}>Didn&rsquo;t go (tries again every 15 minutes)</h3>
          <ul className={crm.noteList}>
            {status.failed.map((r) => (
              <li key={r.id} className={crm.noteItem}>
                <div className={crm.noteMeta}>{rowHead(r)}</div>
                <div>{r.error}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      {status.gone.length > 0 && (
        <>
          <h3 className={crm.sectionTitle} style={SUBHEAD}>In QuickBooks but no longer in the app: remove these there by hand</h3>
          <ul className={crm.noteList}>
            {status.gone.map((g) => (
              <li key={g.id} className={crm.noteItem}>
                <div className={crm.noteMeta}>
                  {g.ref ?? "No ref"} · QuickBooks {g.txnType === "Deposit" ? "deposit" : "expense"} {g.txnId} · {when(g.at)}
                </div>
                <div>{g.reason}.</div>
                <form method="post" action="/api/quickbooks/feed" style={{ marginTop: 6 }}>
                  <input type="hidden" name="action" value="done" />
                  <input type="hidden" name="id" value={g.id} />
                  <button className={crm.btn} type="submit">
                    Done: removed in QuickBooks
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className={crm.sectionTitle} style={{ ...SUBHEAD, marginTop: 28 }}>
        Where entries go
      </h3>
      <form method="post" action="/api/quickbooks/feed" style={{ display: "grid", gap: 14, maxWidth: 640 }}>
        <input type="hidden" name="action" value="save" />
        <label className={crm.field}>
          <span>Start date: nothing dated earlier is sent</span>
          <input type="date" name="startDate" defaultValue={s.startDate ?? todayISO()} style={{ maxWidth: 220 }} />
        </label>

        {METHODS.map((m) => (
          <label key={m} className={crm.field}>
            <span>Paid by {m}: from this account</span>
            <select name={payField(m)} defaultValue={pick(s.payFrom[m], guess.payFrom[m]) ?? ""}>
              <option value="">Not sent (choose an account)</option>
              {payAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ))}

        <label className={crm.field}>
          <span>Every site expense is booked to</span>
          <select name="expenseAccount" defaultValue={pick(s.expenseAccount, guess.expenseAccount) ?? ""}>
            <option value="">Choose the cost account</option>
            {otherAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.type})
              </option>
            ))}
          </select>
        </label>

        <label className={crm.field}>
          <span>Every marketing event (Event entry) is booked to</span>
          <select name="eventAccount" defaultValue={pick(s.eventAccount, guess.eventAccount) ?? ""}>
            <option value="">Choose the account for marketing events</option>
            {otherAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.type})
              </option>
            ))}
          </select>
        </label>

        {lists.classes.length > 0 &&
          CATEGORIES.map((c) => (
            <label key={c} className={crm.field}>
              <span>Class for site {c.toLowerCase()}</span>
              <select name={classField(c)} defaultValue={s.classFor[c] ?? ""}>
                <option value="">No class</option>
                {lists.classes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          ))}

        {lists.locations.length > 0 && (
          <label className={crm.field}>
            <span>Location for every site entry</span>
            <select name="location" defaultValue={s.location ?? ""}>
              <option value="">No location</option>
              {lists.locations.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className={crm.sectionHint} style={{ marginTop: 8 }}>
          Money in: where it comes from decides where it goes in the books (e.g. &ldquo;Leo&rdquo; goes to his shareholder loan). Money in
          from anyone else waits for you.
        </p>
        {Array.from({ length: RULE_ROWS }, (_, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: 10, alignItems: "end" }}>
            <label className={crm.field}>
              <span>Money in from</span>
              <input name={`rule_match_${i}`} defaultValue={rules[i]?.match ?? ""} placeholder="e.g. Leo" />
            </label>
            <label className={crm.field}>
              <span>goes to</span>
              <select name={`rule_account_${i}`} defaultValue={rules[i]?.account ?? ""}>
                <option value="">Choose an account</option>
                {otherAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.type})
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}

        <div className={crm.actions} style={{ marginTop: 12 }}>
          <button className={`${crm.btn} ${crm.btnPrimary}`} type="submit">
            Save
          </button>
        </div>
        {s.updatedAt && <p className={crm.sectionHint}>Last saved {when(s.updatedAt)}.</p>}
      </form>
    </section>
  );
}

/** The feed panel's small headings (the CRM's section title is sized for a whole page). */
const SUBHEAD = { fontSize: "1.05rem", margin: "18px 0 6px" } as const;

const rowHead = (r: FeedRow) => `${r.ref ?? "No ref"} · ${day(r.date)} · ${r.supplier || (r.kind === "inflow" ? "Money in" : "No supplier")} · ${money(r.amount)}`;

function Rows({ title, rows, empty }: { title: string; rows: FeedRow[]; empty?: string }) {
  return (
    <>
      <h3 className={crm.sectionTitle} style={SUBHEAD}>{title}</h3>
      {rows.length === 0 ? (
        empty && <p className={crm.sectionHint}>{empty}</p>
      ) : (
        <ul className={crm.noteList}>
          {rows.slice(0, 25).map((r) => (
            <li key={r.id} className={crm.noteItem}>
              <div className={crm.noteMeta}>{rowHead(r)}</div>
              <div>{r.line}</div>
            </li>
          ))}
          {rows.length > 25 && <li className={crm.sectionHint}>and {rows.length - 25} more.</li>}
        </ul>
      )}
    </>
  );
}
