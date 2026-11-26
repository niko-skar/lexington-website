"use client";

import { deleteLeadAction } from "@/lib/actions/crm";
import { paymentLabel } from "@/lib/crm";
import type { ProspectData } from "@/lib/crmPage";
import { formatUSD, phoneHref, whatsappUrl } from "@/lib/format";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";
import { CopyNumber } from "./CopyNumber";
import styles from "./Crm.module.css";
import { LeadLink, ListLink, useCrmHost } from "./CrmHost";
import { openTasksOf } from "./data";
import { NotesPanel, StepsPanel } from "./LeadPanels";
import { CreateBuyerFromLeadForm, LeadDetailsForm } from "./LeadForms";
import { ReplyPanel } from "./ReplyPanel";
import { LiveStageChip, LostControls, StagePills, StageProvider } from "./StagePanel";
import { AssignButton, OwnerTag, TeamProvider, useAssign } from "./Team";
import { WhatsAppPanel } from "./WhatsAppPanel";

// One prospect's page: who they are and how to reach them, the suggested reply, their stage, next steps and notes, their
// details, and (the office only) their buyer login and Remove. The admin page (/admin/crm/<id>) and the app's Customers
// part draw the same screen from lib/crmPage.ts prospectData. Whose list they're on is beside their stage, and the office
// gives them to someone (Rahma) or takes them back next to the ways to reach them (20 Nov 2026).

export function ProspectView({ data }: { data: ProspectData }) {
  return (
    <TeamProvider team={data.team ?? []}>
      <ProspectScreen data={data} />
    </TeamProvider>
  );
}

function ProspectScreen({ data }: { data: ProspectData }) {
  const host = useCrmHost();
  const { lead, units, today, origin, chat, chatAs, twin, siteMismatch, defaultPrice, whatsapp } = data;
  const open = openTasksOf(lead).sort((a, b) => (a.due ?? today).localeCompare(b.due ?? today));
  const done = (lead.tasks ?? []).filter((t) => t.done);
  const notes = [...(lead.notes ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const assign = useAssign(lead);

  // In the app the list comes back by itself once the prospect is gone (the admin page moves to the list).
  const removeInApp = async (form: FormData) => {
    form.set("inApp", "1");
    await deleteLeadAction(form);
    host.go?.({});
    await host.refresh().catch(() => undefined);
  };

  return (
    <StageProvider leadId={lead._id} stage={lead.stage ?? "new"}>
      <ListLink className={styles.back}>← All prospects</ListLink>
      <h1 className={styles.prospectTitle}>{lead.name}</h1>
      <div className={styles.rowTop}>
        <LiveStageChip />
        <OwnerTag owner={assign.owner} />
        <span className={styles.sectionHint}>
          {lead.unitNumber ? `Unit ${lead.unitNumber}` : lead.interest || "No unit yet"} ·{" "}
          {paymentLabel(lead.paymentPreference)} · {origin}
          {lead.agreedPriceUSD ? ` · Agreed ${formatUSD(lead.agreedPriceUSD)}` : ""}
        </span>
      </div>
      <div className={styles.contactRow} style={{ marginBottom: twin ? 10 : 20 }}>
        {chat && (
          <a className={styles.btnChat} href={chat.url} target="_blank" rel="noreferrer">
            {chat.label}
            {chatAs ? ` (as ${chatAs})` : ""} ↗
          </a>
        )}
        {lead.phone && (
          <>
            <a className={styles.btn} href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            <a className={styles.btn} href={phoneHref(lead.phone)}>
              Call {lead.phone}
            </a>
            <CopyNumber phone={lead.phone} />
          </>
        )}
        {lead.email && (
          <a className={styles.btn} href={`mailto:${lead.email}`}>
            Email
          </a>
        )}
        {!lead.phone && !lead.email && (
          <span className={styles.sectionHint}>No contact details yet. Add them under Details.</span>
        )}
        <AssignButton assign={assign} />
      </div>

      {twin && (
        <p className={styles.sectionHint} style={{ marginBottom: 20 }}>
          Same phone number as{" "}
          <LeadLink id={twin.id} className={styles.inlineLink}>
            {twin.name}
          </LeadLink>
          {twin.platform ? ` (${twin.platform === "instagram" ? "Instagram" : "Facebook"})` : ""}
          {twin.writtenDifferently ? ", written differently" : ""}: maybe the same person.
        </p>
      )}

      {siteMismatch && <div className={styles.empty} style={{ marginBottom: 24 }}>{siteMismatch}</div>}

      <div className={styles.detailGrid}>
        <div>
          {whatsapp && <WhatsAppPanel lead={lead} lastTheirsAt={whatsapp.lastTheirsAt} open={whatsapp.open} />}
          <ReplyPanel lead={lead} />

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

          {host.office && (
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Buyer login</h2>
              <p className={styles.sectionHint} style={{ marginBottom: 14 }}>
                When they reserve, this gives them their own page to follow their payments and documents.
              </p>
              <CreateBuyerFromLeadForm lead={lead} units={units} defaultPrice={defaultPrice} />
            </section>
          )}

          {host.office && (
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Remove</h2>
              <form action={host.inApp ? removeInApp : deleteLeadAction}>
                <input type="hidden" name="leadId" value={lead._id} />
                <ConfirmSubmitButton
                  message={`Delete ${lead.name} from the CRM? This can't be undone. (A buyer login, if there is one, stays.)`}
                  className={styles.btnDanger}
                >
                  Delete prospect
                </ConfirmSubmitButton>
              </form>
            </section>
          )}
        </div>
      </div>
    </StageProvider>
  );
}
