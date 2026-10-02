"use client";

import { createContext, useCallback, useContext, useState, useTransition, type ReactNode } from "react";

import { addTaskAction } from "@/lib/actions/crm";
import { addDaysISO, firstName } from "@/lib/crm";
import styles from "./Crm.module.css";
import { useToast } from "./Toasts";

interface Ask {
  leadId: string;
  name: string;
}

interface FollowUpApi {
  /** Offer to schedule what happens next with this prospect. */
  ask: (ask: Ask) => void;
}

const Context = createContext<FollowUpApi | null>(null);

// Null outside the prospect lists, where there is nothing to ask in.
export function useFollowUp() {
  return useContext(Context);
}

// Finishing someone's last step is the moment a prospect goes quiet, so the
// lists ask what comes next right then, with the usual answers one tap away.
export function FollowUpProvider({ today, children }: { today: string; children: ReactNode }) {
  const [asks, setAsks] = useState<Ask[]>([]);

  const ask = useCallback((next: Ask) => {
    setAsks((all) => (all.some((a) => a.leadId === next.leadId) ? all : [...all, next]));
  }, []);

  return (
    <Context.Provider value={{ ask }}>
      {asks.length > 0 && (
        <div className={styles.followUps}>
          {asks.map((a) => (
            <FollowUpPrompt
              key={a.leadId}
              ask={a}
              today={today}
              onClose={() => setAsks((all) => all.filter((x) => x.leadId !== a.leadId))}
            />
          ))}
        </div>
      )}
      {children}
    </Context.Provider>
  );
}

// The "Add next step" button on a prospect with nothing scheduled: opens the same
// quick question at the top of the list instead of leaving the page.
export function AskNextStepButton({ leadId, name }: Ask) {
  const followUp = useFollowUp();
  return (
    <button
      type="button"
      className={styles.btnPrimary}
      onClick={() => {
        followUp?.ask({ leadId, name });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    >
      Add next step
    </button>
  );
}

const CHOICES = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
];

function FollowUpPrompt({ ask, today, onClose }: { ask: Ask; today: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [, startTransition] = useTransition();
  const toast = useToast();
  const first = firstName(ask.name);

  function add(days: number) {
    const stepText = text.trim() || `Follow up with ${first}`;
    onClose();
    startTransition(async () => {
      const data = new FormData();
      data.set("leadId", ask.leadId);
      data.set("text", stepText);
      data.set("due", addDaysISO(today, days));
      data.set("waitingOn", "me");
      try {
        const result = await addTaskAction({ status: "idle", message: "" }, data);
        toast.show(result.status === "error" ? result.message : `Next step added for ${first}.`);
      } catch {
        toast.show("Couldn't add that step. Please try again.");
      }
    });
  }

  return (
    <div className={styles.followUp}>
      <p className={styles.followUpTitle}>
        Done. What happens next with <strong>{ask.name}</strong>?
      </p>
      <div className={styles.followUpRow}>
        <input
          className={styles.followUpInput}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add(1);
          }}
          placeholder={`e.g. Send the contract (or leave blank for "Follow up with ${first}")`}
          aria-label={`Next step with ${ask.name}`}
          autoComplete="off"
        />
        <div className={styles.followUpChoices}>
          {CHOICES.map((choice) => (
            <button key={choice.days} type="button" className={styles.btn} onClick={() => add(choice.days)}>
              {choice.label}
            </button>
          ))}
          <button type="button" className={styles.followUpSkip} onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
