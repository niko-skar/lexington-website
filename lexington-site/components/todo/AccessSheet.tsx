"use client";

import { useEffect, useState } from "react";

import { SITE_SECTIONS, type SiteAccount, type SiteSection } from "@/lib/todo/shared";
import styles from "./Todo.module.css";

const APP_ADDRESS = "https://www.lexington.com.gh/todo";

const PART: Record<SiteSection, string> = { todo: "To-do list", store: "Store room" };

function message(name: string, email: string, password: string, sections: SiteSection[]) {
  const what = sections.length === 2 ? "site to-do list and store room" : sections[0] === "store" ? "store room" : "site to-do list";
  return [
    `Hi ${name.split(" ")[0]}, this is the Lexington ${what}.`,
    `Open: ${APP_ADDRESS}`,
    `Email: ${email}`,
    `Password: ${password}`,
    "Then in Chrome tap ⋮ and Add to Home screen (or Install app) so it opens like an app.",
    ...(sections.includes("todo") ? ["Tick each job when it's done, and add a photo of the fix if you can."] : []),
    ...(sections.includes("store") ? ["Record every material that leaves the store: Store, tap the item, Take out."] : []),
  ].join("\n");
}

async function call(method: string, body?: unknown, query = "") {
  const response = await fetch(`/api/todo/access${query}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!response) throw new Error("No signal. Try again when you have data.");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "That didn't work. Try again.");
  return data;
}

/** Buttons to choose which parts of the app a login opens (at least one). */
function Parts({ value, onChange, disabled }: { value: SiteSection[]; onChange: (next: SiteSection[]) => void; disabled?: boolean }) {
  return (
    <div className={styles.chips}>
      {SITE_SECTIONS.map((section) => {
        const on = value.includes(section);
        return (
          <button
            key={section}
            type="button"
            className={on ? styles.chipOn : styles.chip}
            aria-pressed={on}
            disabled={disabled || (on && value.length === 1)}
            onClick={() => onChange(on ? value.filter((s) => s !== section) : SITE_SECTIONS.filter((s) => s === section || value.includes(s)))}
          >
            {on ? "✓ " : ""}
            {PART[section]}
          </button>
        );
      })}
    </div>
  );
}

/** The office's list of site logins (the foreman, a storekeeper): add one, choose what it opens, send a new password, or remove it. */
export function AccessSheet({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<SiteAccount[] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sections, setSections] = useState<SiteSection[]>([...SITE_SECTIONS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ title: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    call("GET")
      .then((data) => setAccounts(data.accounts))
      .catch((e) => setError(e.message));
  }, []);

  const create = async () => {
    setError("");
    setBusy(true);
    try {
      const data = await call("POST", { name, email, sections });
      const account = data.account as SiteAccount;
      setAccounts((list) => [...(list ?? []), account].sort((a, b) => a.name.localeCompare(b.name)));
      setResult({ title: `Send this to ${account.name}`, text: message(account.name, account.email, data.password, account.sections) });
      setName("");
      setEmail("");
      setSections([...SITE_SECTIONS]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async (account: SiteAccount) => {
    setError("");
    setBusy(true);
    try {
      const data = await call("PATCH", { id: account.id });
      setResult({ title: `New password for ${account.name}: send this`, text: message(account.name, account.email, data.password, account.sections) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const changeParts = async (account: SiteAccount, next: SiteSection[]) => {
    setError("");
    setBusy(true);
    try {
      const data = await call("PATCH", { id: account.id, sections: next });
      setAccounts((list) => (list ?? []).map((a) => (a.id === account.id ? { ...a, sections: data.sections } : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (account: SiteAccount) => {
    setArmed(null);
    setError("");
    setBusy(true);
    try {
      await call("DELETE", undefined, `?id=${encodeURIComponent(account.id)}`);
      setAccounts((list) => (list ?? []).filter((a) => a.id !== account.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      (document.getElementById("todo-access-text") as HTMLTextAreaElement | null)?.select();
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Site logins">
        <h2 className={styles.sheetTitle}>Site logins</h2>
        <p className={styles.sheetNote}>
          These logins open only what is ticked: the to-do list (tick jobs off, add photos of the fix) and/or the store room (take out, bring back, count;
          never prices). Only the office adds jobs, sees the expenses or changes store items.
        </p>

        {result && (
          <div className={styles.result}>
            <p className={styles.label}>{result.title}</p>
            <textarea id="todo-access-text" className={styles.textarea} readOnly rows={8} value={result.text} />
            <div className={styles.sheetButtons}>
              <button type="button" className={styles.sheetSave} onClick={() => void copy()}>
                {copied ? "Copied" : "Copy for WhatsApp"}
              </button>
              <button type="button" className={styles.sheetCancel} onClick={() => setResult(null)}>
                Done
              </button>
            </div>
            <p className={styles.sheetNote}>The password is shown only now. If it gets lost, press New password.</p>
          </div>
        )}

        {accounts === null ? (
          <p className={styles.sheetNote}>Loading…</p>
        ) : accounts.length === 0 ? (
          <p className={styles.sheetNote}>No site logins yet.</p>
        ) : (
          <ul className={styles.accounts}>
            {accounts.map((a) => (
              <li key={a.id}>
                <div>
                  <b>{a.name || "No name"}</b>
                  <span>{a.email}</span>
                </div>
                <Parts value={a.sections} onChange={(next) => void changeParts(a, next)} disabled={busy} />
                <div className={styles.accountButtons}>
                  <button type="button" onClick={() => void reset(a)} disabled={busy}>
                    New password
                  </button>
                  <button
                    type="button"
                    className={armed === a.id ? styles.dangerArmed : styles.danger}
                    onClick={() => (armed === a.id ? void remove(a) : setArmed(a.id))}
                    disabled={busy}
                  >
                    {armed === a.id ? "Tap again to remove" : "Remove"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <h3 className={styles.label}>Give someone access</h3>
        <label className={styles.smallLabel} htmlFor="todo-access-name">
          Name
        </label>
        <input id="todo-access-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="e.g. Kwame Mensah" />
        <label className={styles.smallLabel} htmlFor="todo-access-email">
          Their email (they sign in with it)
        </label>
        <input
          id="todo-access-email"
          className={styles.input}
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          placeholder="e.g. kwame@gmail.com"
        />
        <span className={styles.smallLabel}>What it opens</span>
        <Parts value={sections} onChange={setSections} disabled={busy} />

        {error && <p className={styles.sheetError}>{error}</p>}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose}>
            Close
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void create()} disabled={busy || !name.trim() || !email.trim()}>
            {busy ? "Working…" : "Create login"}
          </button>
        </div>
      </div>
    </div>
  );
}
