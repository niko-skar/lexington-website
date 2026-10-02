"use client";

import Link from "next/link";
import { useState } from "react";

import { SOURCES, STAGES, dueLabel, dueState, paymentLabel, sourceLabel } from "@/lib/crm";
import { phoneHref, whatsappUrl } from "@/lib/format";
import type { Lead } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { StageSelect } from "./StageSelect";
import { nextTaskOf, unitLine } from "./data";

const DUE_CLASS = {
  overdue: styles.dueOverdue,
  today: styles.dueToday,
  soon: styles.dueSoon,
  later: styles.dueLater,
  none: styles.dueNone,
};

// Search and filters work as you type, with no trip to the server.
export function AllView({
  leads,
  today,
  q: q0,
  stage: stage0,
  source: source0,
}: {
  leads: Lead[];
  today: string;
  q: string;
  stage: string;
  source: string;
}) {
  const [q, setQ] = useState(q0);
  const [stage, setStage] = useState(stage0);
  const [source, setSource] = useState(source0);

  // A link that opens the page with filters already set (e.g. "Lost") wins
  // over whatever was typed before.
  const signature = `${q0}|${stage0}|${source0}`;
  const [seen, setSeen] = useState(signature);
  if (signature !== seen) {
    setSeen(signature);
    setQ(q0);
    setStage(stage0);
    setSource(source0);
  }

  const needle = q.trim().toLowerCase();
  const shown = leads.filter((l) => {
    if (stage && l.stage !== stage) return false;
    if (source && l.source !== source) return false;
    if (!needle) return true;
    return [l.name, l.email, l.phone, l.unitNumber, l.interest]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  return (
    <>
      <div className={styles.filters}>
        <div className={styles.field}>
          <label htmlFor="q">Search</label>
          <input
            id="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, phone, email or unit"
            autoComplete="off"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="stage">Stage</label>
          <select id="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="source">Where from</label>
          <select id="source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Anywhere</option>
            {SOURCES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.sectionHead}>
        <span className={styles.sectionHint}>
          {shown.length} of {leads.length} prospects
        </span>
      </div>

      {shown.length === 0 ? (
        <div className={styles.empty}>No prospects match.</div>
      ) : (
        <div className={styles.rows}>
          {shown.map((lead) => {
            const task = lead.stage === "lost" ? undefined : nextTaskOf(lead, today);
            return (
              <div key={lead._id} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTop}>
                    <Link href={`/admin/crm/${lead._id}`} className={styles.leadLink}>
                      {lead.name}
                    </Link>
                    <StageSelect leadId={lead._id} stage={lead.stage} />
                  </div>
                  <div className={styles.rowMeta}>
                    <span>{unitLine(lead)}</span>
                    <span>{sourceLabel(lead.source)}</span>
                    <span>{paymentLabel(lead.paymentPreference)}</span>
                  </div>
                  {lead.context && <div className={styles.rowContext}>{lead.context}</div>}
                  {task && (
                    <div className={styles.rowText}>
                      {task.text}{" "}
                      <span className={DUE_CLASS[dueState(task.due, today)]}>
                        · {dueLabel(task.due, today)}
                        {task.waitingOn === "them" ? " (waiting on them)" : ""}
                      </span>
                    </div>
                  )}
                </div>
                <div className={styles.actions}>
                  {lead.phone && (
                    <>
                      <a className={styles.btn} href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer">
                        WhatsApp
                      </a>
                      <a className={styles.btn} href={phoneHref(lead.phone)}>
                        Call
                      </a>
                    </>
                  )}
                  <Link href={`/admin/crm/${lead._id}`} className={styles.btn}>
                    Open
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
