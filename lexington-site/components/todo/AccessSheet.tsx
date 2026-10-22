"use client";

import { useEffect, useState } from "react";

import type { SiteAccount } from "@/lib/todo/shared";
import styles from "./Todo.module.css";

const LIST_ADDRESS = "https://www.lexington.com.gh/todo";

function message(name: string, email: string, password: string) {
  return [
    `Hi ${name.split(" ")[0]}, this is the Lexington site to-do list.`,
    `Open: ${LIST_ADDRESS}`,
    `Email: ${email}`,
    `Password: ${password}`,
    "Then in Chrome tap ⋮ and Add to Home screen (or Install app) so it opens like an app.",
    "Tick each job when it's done, and add a photo of the fix if you can.",
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

/** The office's list of foreman logins: add one, send a new password, or remove access. */
export function AccessSheet({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<SiteAccount[] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
      const data = await call("POST", { name, email });
      setAccounts((list) => [...(list ?? []), data.account].sort((a, b) => a.name.localeCompare(b.name)));
      setResult({ title: `Send this to ${data.account.name}`, text: message(data.account.name, data.account.email, data.password) });
      setName("");
      setEmail("");
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
      setResult({ title: `New password for ${account.name}: send this`, text: message(account.name, account.email, data.password) });
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
      <div className={styles.sheet} role="dialog" aria-label="Foreman logins">
        <h2 className={styles.sheetTitle}>Foreman logins</h2>
        <p className={styles.sheetNote}>
          These logins open this list and nothing else on the website. They can tick jobs off and add photos of the fix; only the office can add or delete jobs.
        </p>

        {result && (
          <div className={styles.result}>
            <p className={styles.label}>{result.title}</p>
            <textarea id="todo-access-text" className={styles.textarea} readOnly rows={7} value={result.text} />
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
          <p className={styles.sheetNote}>No foreman logins yet.</p>
        ) : (
          <ul className={styles.accounts}>
            {accounts.map((a) => (
              <li key={a.id}>
                <div>
                  <b>{a.name || "No name"}</b>
                  <span>{a.email}</span>
                </div>
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
