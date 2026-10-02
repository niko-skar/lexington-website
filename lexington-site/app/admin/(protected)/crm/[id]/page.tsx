import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/components/crm/Crm.module.css";
import { ConfirmSubmitButton } from "@/components/crm/ConfirmSubmitButton";
import { openTasksOf } from "@/components/crm/data";
import { NotesPanel, StepsPanel } from "@/components/crm/LeadPanels";
import { CreateBuyerFromLeadForm, LeadDetailsForm } from "@/components/crm/LeadForms";
import { LiveStageChip, LostControls, StagePills, StageProvider } from "@/components/crm/StagePanel";
import { deleteLeadAction } from "@/lib/actions/crm";
import { requireAdminPage } from "@/lib/auth/requireAdmin";
import { STAGES, paymentLabel, sourceLabel, todayISO } from "@/lib/crm";
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
    client.fetch<UnitOption[]>(unitOptionsQuery, {}, { next: { revalidate: 300 } }),
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
    <main className={styles.crmPage}>
      <StageProvider leadId={lead._id} stage={lead.stage ?? "new"}>
      <Link href="/admin/crm" className={styles.back}>
        ← All prospects
      </Link>
      <h1 className={styles.prospectTitle}>{lead.name}</h1>
      <div className={styles.rowTop}>
        <LiveStageChip />
        <span className={styles.sectionHint}>
          {lead.unitNumber ? `Unit ${lead.unitNumber}` : lead.interest || "No unit yet"} ·{" "}
          {paymentLabel(lead.paymentPreference)} · {sourceLabel(lead.source)}
          {lead.agreedPriceUSD ? ` · Agreed ${formatUSD(lead.agreedPriceUSD)}` : ""}
        </span>
      </div>
      <div className={styles.contactRow} style={{ marginBottom: 20 }}>
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
            <StagePills />
            <LostControls lostReason={lead.lostReason} />
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Next steps</h2>
            <StepsPanel lead={lead} open={open} done={done} today={today} />
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Notes</h2>
            <NotesPanel leadId={lead._id} notes={notes} />
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
      </StageProvider>
    </main>
  );
}
