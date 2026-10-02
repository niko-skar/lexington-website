import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/components/crm/Crm.module.css";
import { ConfirmSubmitButton } from "@/components/crm/ConfirmSubmitButton";
import { openTasksOf } from "@/components/crm/data";
import { AddNoteForm, AddTaskForm, CreateBuyerFromLeadForm, LeadDetailsForm } from "@/components/crm/LeadForms";
import { StageChip } from "@/components/crm/StageChip";
import { TaskRow } from "@/components/crm/TaskRow";
import portal from "@/components/Portal.module.css";
import { deleteLeadAction, setStageAction } from "@/lib/actions/crm";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { LOST_REASONS, STAGES, formatWhen, paymentLabel, sourceLabel, todayISO } from "@/lib/crm";
import { formatUSD, phoneHref, whatsappUrl } from "@/lib/format";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { client } from "@/lib/sanity/client";
import { leadByIdQuery } from "@/lib/sanity/crmQueries";
import type { Lead, UnitOption } from "@/lib/sanity/crmTypes";
import { unitOptionsQuery } from "@/lib/sanity/queries";

export const metadata = {
  title: "Prospect | The Lexington",
};

const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const SOLD_STAGES = ["reserved", "paying", "paid", "handed_over"];

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();

  const { id } = await params;
  if (!ID_RE.test(id)) notFound();

  const [lead, units] = await Promise.all([
    getBuyersClient().fetch<Lead | null>(leadByIdQuery, { id }),
    client.fetch<UnitOption[]>(unitOptionsQuery),
  ]);
  if (!lead) notFound();

  const today = todayISO();
  const open = openTasksOf(lead).sort((a, b) => (a.due ?? today).localeCompare(b.due ?? today));
  const done = (lead.tasks ?? []).filter((t) => t.done);
  const notes = [...(lead.notes ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const unit = units.find((u) => u.unitNumber === lead.unitNumber);
  const defaultPrice = lead.agreedPriceUSD ?? unit?.priceUSD;

  // The website's unit status is changed by hand in Studio on purpose; this
  // just points out when it no longer matches where the prospect is.
  const siteMismatch =
    unit && SOLD_STAGES.includes(lead.stage) && unit.status === "available"
      ? `This prospect is at "${STAGES.find((s) => s.key === lead.stage)?.label}" but the website still lists unit ${unit.unitNumber} as available. Update it in Studio when you're ready.`
      : null;

  return (
    <main className={portal.page}>
      <Link href="/admin/crm" className={styles.back}>
        ← All prospects
      </Link>
      <div className={portal.eyebrow}>Prospect</div>
      <h1 className={portal.title} style={{ marginBottom: 12 }}>
        {lead.name}
      </h1>
      <div className={styles.rowTop}>
        <StageChip stage={lead.stage} />
        <span className={styles.sectionHint}>
          {lead.unitNumber ? `Unit ${lead.unitNumber}` : lead.interest || "No unit yet"} ·{" "}
          {paymentLabel(lead.paymentPreference)} · {sourceLabel(lead.source)}
          {lead.agreedPriceUSD ? ` · Agreed ${formatUSD(lead.agreedPriceUSD)}` : ""}
        </span>
      </div>
      <div className={styles.contactRow} style={{ marginBottom: 28 }}>
        {lead.phone && (
          <>
            <a className={styles.btn} href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            <a className={styles.btn} href={phoneHref(lead.phone)}>
              Call {lead.phone}
            </a>
          </>
        )}
        {lead.email && (
          <a className={styles.btn} href={`mailto:${lead.email}`}>
            Email
          </a>
        )}
        {!lead.phone && !lead.email && (
          <span className={styles.sectionHint}>No contact details yet. Add them on the right.</span>
        )}
      </div>

      {siteMismatch && <div className={styles.empty} style={{ marginBottom: 24 }}>{siteMismatch}</div>}

      <div className={styles.detailGrid}>
        <div>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Stage</h2>
            <div className={styles.stageRow}>
              {STAGES.filter((s) => s.key !== "lost").map((s) =>
                s.key === lead.stage ? (
                  <span key={s.key} className={styles.stagePillActive}>
                    {s.label}
                  </span>
                ) : (
                  <form key={s.key} action={setStageAction}>
                    <input type="hidden" name="leadId" value={lead._id} />
                    <input type="hidden" name="stage" value={s.key} />
                    <button type="submit" className={styles.stagePill}>
                      {s.label}
                    </button>
                  </form>
                )
              )}
            </div>
            {lead.stage === "lost" ? (
              <div className={styles.lostForm}>
                <span className={styles.sectionHint}>Lost{lead.lostReason ? `: ${lead.lostReason}` : ""}</span>
                <form action={setStageAction}>
                  <input type="hidden" name="leadId" value={lead._id} />
                  <input type="hidden" name="stage" value="contacted" />
                  <button type="submit" className={styles.btn}>
                    Reopen
                  </button>
                </form>
              </div>
            ) : (
              <form action={setStageAction} className={styles.lostForm}>
                <input type="hidden" name="leadId" value={lead._id} />
                <input type="hidden" name="stage" value="lost" />
                <select name="lostReason" defaultValue="" aria-label="Why they're lost">
                  <option value="">Not going ahead because…</option>
                  {LOST_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button type="submit" className={styles.btnDanger}>
                  Mark lost
                </button>
              </form>
            )}
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Next steps</h2>
            {open.length === 0 ? (
              <div className={styles.empty}>Nothing scheduled. Add the next step below.</div>
            ) : (
              <div className={styles.rows} style={{ marginBottom: 18 }}>
                {open.map((task) => (
                  <TaskRow
                    key={task._key}
                    lead={lead}
                    task={task}
                    today={today}
                    mode={task.waitingOn === "them" ? "them" : "me"}
                    showLead={false}
                  />
                ))}
              </div>
            )}
            <AddTaskForm leadId={lead._id} today={today} />
            {done.length > 0 && (
              <details className={styles.doneList}>
                <summary>Done ({done.length})</summary>
                {done.map((t) => (
                  <div key={t._key} className={styles.doneItem}>
                    {t.text}
                  </div>
                ))}
              </details>
            )}
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Notes</h2>
            <AddNoteForm leadId={lead._id} />
            <div className={styles.noteList}>
              {notes.map((n) => (
                <div key={n._key} className={`${styles.noteItem} ${n.kind !== "note" ? styles.noteSystem : ""}`}>
                  <div className={styles.noteMeta}>{formatWhen(n.at)}</div>
                  {n.text}
                </div>
              ))}
              {notes.length === 0 && <div className={styles.empty}>No notes yet.</div>}
            </div>
          </section>
        </div>

        <div>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Details</h2>
            <LeadDetailsForm lead={lead} units={units} />
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Buyer login</h2>
            <p className={styles.sectionHint} style={{ marginBottom: 14 }}>
              When they reserve, this gives them their own page to follow their payments and documents.
            </p>
            <CreateBuyerFromLeadForm lead={lead} units={units} defaultPrice={defaultPrice} />
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Remove</h2>
            <form action={deleteLeadAction}>
              <input type="hidden" name="leadId" value={lead._id} />
              <ConfirmSubmitButton
                message={`Delete ${lead.name} from the CRM? This can't be undone. (A buyer login, if there is one, stays.)`}
                className={styles.btnDanger}
              >
                Delete prospect
              </ConfirmSubmitButton>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
