"use client";

import { createContext, useContext, useOptimistic, useTransition, type ReactNode } from "react";

import { assignLeadAction } from "@/lib/actions/crm";
import { firstName } from "@/lib/crm";
import type { CrmTeamMember, Lead } from "@/lib/sanity/crmTypes";
import styles from "./Crm.module.css";
import { runChange, useCrmHost } from "./CrmHost";
import { useToast } from "./Toasts";
import { ownerOf } from "./data";

// Whose list a prospect is on (20 Nov 2026, Niko: "make me a button that will push one of these to rahma so she has her
// own list, that way i can keep separate the ones I need to deal with and the ones that I want her to deal with"). The
// team is the app's logins with Customers; a prospect given to none of them is on the office's list. Only the office
// gives a prospect to someone or takes it back.

const TeamContext = createContext<CrmTeamMember[]>([]);

export function TeamProvider({ team, children }: { team: CrmTeamMember[]; children: ReactNode }) {
  return <TeamContext.Provider value={team}>{children}</TeamContext.Provider>;
}

export function useTeam(): CrmTeamMember[] {
  return useContext(TeamContext);
}

type AssignLead = Pick<Lead, "_id" | "name" | "assignedTo">;

export interface Assign {
  /** Whose list it's on now ("" = the office's), changed on screen straight away. */
  owner: string;
  /** Whose list it's on as saved (what the screen was drawn from). */
  saved: string;
  team: CrmTeamMember[];
  office: boolean;
  give: (to: string) => void;
}

/**
 * A prospect's list, changed on screen at once and saved in the background, with an Undo for a few seconds. A row in a
 * list leaves it as soon as `owner` differs from `saved` (it's on someone else's list now).
 */
export function useAssign(lead: AssignLead): Assign {
  const host = useCrmHost();
  const team = useTeam();
  const toast = useToast();
  const saved = ownerOf(lead, team);
  const [owner, setOwner] = useOptimistic(saved);
  const [, startTransition] = useTransition();

  const send = (to: string) => {
    const data = new FormData();
    data.set("leadId", lead._id);
    data.set("to", to);
    return runChange(host, assignLeadAction, data);
  };

  function give(to: string) {
    const who = team.find((m) => m.id === (to || saved));
    const name = who ? firstName(who.name) : "";
    let failed = false;
    startTransition(async () => {
      setOwner(to);
      try {
        await send(to);
      } catch {
        failed = true;
        toast.show(`Couldn't move ${lead.name}. Please try again.`);
      }
    });
    toast.show(to ? `Given to ${name}: ${lead.name}` : `Back on your list: ${lead.name}`, async () => {
      if (!failed) await send(saved);
    });
  }

  return { owner, saved, team, office: host.office, give };
}

/** The office's button: "Give to Rahma" (a choice when there are several), or "Take back" when it's on someone's list. */
export function AssignButton({ assign }: { assign: Assign }) {
  const { owner, team, office, give } = assign;
  if (!office || team.length === 0) return null;
  if (owner) {
    return (
      <button type="button" className={styles.btn} onClick={() => give("")}>
        Take back
      </button>
    );
  }
  if (team.length === 1) {
    return (
      <button type="button" className={styles.btnGive} onClick={() => give(team[0].id)}>
        Give to {firstName(team[0].name)}
      </button>
    );
  }
  return (
    <select
      className={styles.btnGive}
      value=""
      aria-label="Give to someone"
      onChange={(e) => {
        if (e.target.value) give(e.target.value);
      }}
    >
      <option value="">Give to…</option>
      {team.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

/** Whose list it's on, beside the name ("Rahma's list", or "Your list" for her); nothing for the office's own. */
export function OwnerTag({ owner }: { owner: string }) {
  const team = useTeam();
  const host = useCrmHost();
  const who = owner ? team.find((m) => m.id === owner) : undefined;
  if (!who) return null;
  return <span className={styles.ownerTag}>{!host.office && host.me === owner ? "Your list" : `${firstName(who.name)}'s list`}</span>;
}
