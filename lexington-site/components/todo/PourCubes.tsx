"use client";

import { useId, useState } from "react";

import { average, dayWords, isDue, shareOf, USUAL_SHARE, type CubeTest, type PourCubes } from "@/lib/concrete/pourExtras";
import type { ConcreteData, PourBooking } from "@/lib/concrete/shared";
import { ghanaDay } from "@/lib/store/shared";
import { errorText, send } from "./api";
import { shrink } from "./photo";
import ps from "./Pours.module.css";
import styles from "./Todo.module.css";

// A poured pour's concrete cubes (lib/concrete/pourExtras.ts says what and why): how many were taken, and each test at
// 7, 14 and 28 days, due from the pour's day. The lab's form goes on the test and is read: what it says fills in the
// test day and each cube's strength, to check before saving.

const targetWords = (target: number) => (target === 35 ? "C35 (35 MPa)" : `${target} MPa`);
/** A day inside a sentence: "due today", "due Tue 10 Nov". */
const dayInText = (day: string) => {
  const words = dayWords(day);
  return /^(Today|Tomorrow|Yesterday)$/.test(words) ? words.toLowerCase() : words;
};

/** How a test stands: its result against the target, or when it's due. */
function testState(t: CubeTest, target: number, today: string): { text: string; note: string; tone: "ok" | "low" | "due" | "late" | "wait" } {
  if (t.average !== null) {
    const share = shareOf(t.average, target) ?? 0;
    const usual = USUAL_SHARE[t.age] ?? 100;
    const text = `${t.average} MPa · ${share}% of ${target}`;
    if (t.age >= 28) return share >= 100 ? { text, note: `Meets the ${target} MPa aimed for`, tone: "ok" } : { text, note: `Below the ${target} MPa aimed for`, tone: "low" };
    return share >= usual
      ? { text, note: `On track: about ${usual}% is usual by ${t.age} days`, tone: "ok" }
      : { text, note: `Low for ${t.age} days: about ${usual}% is usual`, tone: "low" };
  }
  if (t.reading === "working") return { text: "Reading the lab's form…", note: "", tone: "wait" };
  if (!t.due) return { text: "", note: "", tone: "wait" };
  if (t.due === today) return { text: "Due today", note: "Crush them at the lab, then add the results", tone: "due" };
  if (t.due < today) {
    const late = Math.round((Date.parse(today) - Date.parse(t.due)) / 86_400_000);
    return { text: `${late} ${late === 1 ? "day" : "days"} late`, note: `Was due ${dayInText(t.due)}: add the results`, tone: "late" };
  }
  return { text: `Due ${dayInText(t.due)}`, note: "", tone: "wait" };
}

const TONE_CLASS = { ok: ps.testOk, low: ps.testLow, due: ps.testDue, late: ps.testLate, wait: "" } as const;

export function PourCubesCard({
  pour,
  cubes,
  onData,
  onToast,
}: {
  pour: PourBooking;
  cubes: PourCubes;
  onData: (data: ConcreteData) => void;
  onToast: (text: string, error?: boolean) => void;
}) {
  const [sheet, setSheet] = useState<number | "count" | null>(null);
  const today = ghanaDay();
  const test = typeof sheet === "number" ? cubes.tests.find((t) => t.age === sheet) : undefined;
  return (
    <div className={ps.cubes}>
      <div className={ps.top}>
        <p className={ps.progress}>Concrete cubes</p>
        <button type="button" className={ps.link} onClick={() => setSheet("count")}>
          {cubes.taken === null ? "How many taken?" : "Change"}
        </button>
      </div>
      <p className={ps.line}>
        {cubes.taken === null
          ? `Say how many cubes were taken at the pour. Aiming for ${targetWords(cubes.target)}.`
          : `${cubes.taken} ${cubes.taken === 1 ? "cube" : "cubes"} taken · aiming for ${targetWords(cubes.target)}`}
      </p>
      <ul className={ps.tests}>
        {cubes.tests.map((t) => {
          const s = testState(t, cubes.target, today);
          return (
            <li key={t.age}>
              <button type="button" className={`${ps.test} ${TONE_CLASS[s.tone]}`} onClick={() => setSheet(t.age)} aria-label={`${t.age}-day test: ${s.text}`}>
                <span className={ps.testAge}>{t.age} days</span>
                <span className={ps.testBody}>
                  <span>{s.text}</span>
                  {s.note && <small>{s.note}</small>}
                </span>
                <span className={ps.testGo} aria-hidden="true">
                  {t.form ? "📎" : ""} ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {sheet === "count" && (
        <CubeCountSheet
          pour={pour}
          cubes={cubes}
          onClose={() => setSheet(null)}
          onSaved={(data) => {
            onData(data);
            setSheet(null);
            onToast("Saved");
          }}
        />
      )}
      {test && (
        <CubeTestSheet
          pour={pour}
          test={test}
          target={cubes.target}
          onData={onData}
          onClose={() => setSheet(null)}
          onSaved={(data) => {
            onData(data);
            setSheet(null);
            onToast(`${test.age}-day results saved`);
          }}
        />
      )}
    </div>
  );
}

function CubeCountSheet({ pour, cubes, onClose, onSaved }: { pour: PourBooking; cubes: PourCubes; onClose: () => void; onSaved: (data: ConcreteData) => void }) {
  const [taken, setTaken] = useState(cubes.taken === null ? "" : String(cubes.taken));
  const [target, setTarget] = useState(String(cubes.target));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    const body: Record<string, unknown> = { action: "cubes", pourId: pour.id, target: Number(target.replace(",", ".")) };
    if (taken.trim()) body.taken = Number(taken);
    setSaving(true);
    setError("");
    try {
      onSaved(await send<ConcreteData>("/api/concrete/pours", "POST", body));
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Concrete cubes">
        <h2 className={styles.sheetTitle}>Cubes: {pour.what}</h2>
        <div className={ps.grid2}>
          <label className={styles.label}>
            Cubes taken
            <input className={styles.input} inputMode="numeric" value={taken} onChange={(e) => setTaken(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 9" disabled={saving} />
          </label>
          <label className={styles.label}>
            Aiming for (MPa)
            <input className={styles.input} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="35" disabled={saving} />
          </label>
        </div>
        <p className={styles.sheetNote}>Usually 3 cubes for each test: 7, 14 and 28 days. C35 is 35 MPa at 28 days.</p>
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const MAX_CUBES = 12;

/** One test: the lab's form (read to fill in the rest), the day tested and each cube's strength. */
function CubeTestSheet({
  pour,
  test,
  target,
  onData,
  onClose,
  onSaved,
}: {
  pour: PourBooking;
  test: CubeTest;
  target: number;
  onData: (data: ConcreteData) => void;
  onClose: () => void;
  onSaved: (data: ConcreteData) => void;
}) {
  const id = useId();
  const today = ghanaDay();
  const defaultDay = test.due && test.due <= today ? test.due : today;
  // Until something is typed here, the test as saved shows (so what the form's reading fills in appears as it arrives).
  const [typedDay, setTypedDay] = useState<string | null>(null);
  const [typed, setTyped] = useState<string[] | null>(null);
  const day = typedDay ?? test.testedOn ?? defaultDay;
  const strengths = typed ?? (test.strengths.length ? test.strengths.map(String) : ["", "", ""]);
  const [formBusy, setFormBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const numbers = strengths.map((s) => s.trim().replace(",", ".")).filter(Boolean).map(Number);
  const avg = numbers.every((n) => Number.isFinite(n) && n > 0) ? average(numbers) : null;
  const share = shareOf(avg, target);

  const type = (i: number, value: string) => setTyped(strengths.map((s, j) => (j === i ? value.replace(/[^0-9.,]/g, "") : s)));

  const attach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFormBusy(true);
    setError("");
    try {
      const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      // A photo of the form stays sharp enough to read; a PDF goes as it is.
      const body = pdf ? new File([file], "form.pdf", { type: "application/pdf" }) : await shrink(file, 2200, 0.86).catch(() => file);
      if (body.size > 4_400_000) throw new Error(pdf ? "That PDF is over 4 MB: take a photo of the form instead." : "That photo is too big: take it again.");
      const form = new FormData();
      form.append("file", body, pdf ? "form.pdf" : "form.jpg");
      let response: Response;
      try {
        response = await fetch("/api/concrete/form", { method: "POST", body: form });
      } catch {
        throw new Error("No signal: the form didn't upload. Try again when you have data.");
      }
      const stored = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !stored.id) throw new Error(stored.error || "The form didn't upload. Try again.");
      onData(await send<ConcreteData>("/api/concrete/pours", "POST", { action: "cubeForm", pourId: pour.id, age: test.age, formId: stored.id }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setFormBusy(false);
    }
  };

  const save = async () => {
    if (numbers.some((n) => !Number.isFinite(n) || n <= 0)) return setError("Type each cube's strength in MPa, e.g. 36.5.");
    setSaving(true);
    setError("");
    try {
      onSaved(await send<ConcreteData>("/api/concrete/pours", "POST", { action: "cubeResult", pourId: pour.id, age: test.age, testedOn: day || null, strengths: numbers }));
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const reading = test.reading === "working";
  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label={`${test.age}-day cube test`}>
        <h2 className={styles.sheetTitle}>
          {test.age}-day cubes: {pour.what}
        </h2>
        <p className={styles.sheetNote}>
          Due {dayInText(test.due)} · aiming for {target} MPa
        </p>

        <span className={styles.label}>The lab&rsquo;s results form</span>
        {test.form && (
          <p className={ps.formLine}>
            📎{" "}
            <a href={test.form.url} target="_blank" rel="noreferrer">
              {test.form.type === "application/pdf" ? "The form (PDF)" : "The form"}
            </a>
          </p>
        )}
        <div className={ps.photoButtons}>
          <label htmlFor={`${id}-cam`} className={ps.photoAdd} role="button" tabIndex={0} aria-disabled={formBusy || reading}>
            <span aria-hidden="true">📷</span> {test.form ? "New photo" : "Photo of it"}
          </label>
          <label htmlFor={`${id}-file`} className={ps.photoPick} role="button" tabIndex={0} aria-disabled={formBusy || reading}>
            PDF or photo
          </label>
        </div>
        <input id={`${id}-cam`} className={styles.hiddenInput} type="file" accept="image/*" capture="environment" onChange={(e) => void attach(e)} disabled={formBusy || reading} />
        <input id={`${id}-file`} className={styles.hiddenInput} type="file" accept="image/*,application/pdf" onChange={(e) => void attach(e)} disabled={formBusy || reading} />
        {(formBusy || reading) && (
          <p className={ps.photoNote} role="status">
            {formBusy ? "Sending the form…" : "Reading the form: the results fill in by themselves."}
          </p>
        )}
        {test.readNote && !reading && <p className={test.reading === "failed" ? `${ps.readNote} ${ps.readFailed}` : ps.readNote}>{test.readNote}</p>}

        <label className={styles.label} htmlFor={`${id}-day`}>
          Day tested
        </label>
        <input
          id={`${id}-day`}
          className={styles.input}
          type="date"
          value={day}
          min={pour.poured ?? undefined}
          max={today}
          onChange={(e) => setTypedDay(e.target.value)}
          disabled={saving}
        />
        <span className={styles.label}>Each cube&rsquo;s strength (MPa)</span>
        <div className={ps.strengths}>
          {strengths.map((s, i) => (
            <input key={i} className={styles.input} inputMode="decimal" value={s} onChange={(e) => type(i, e.target.value)} placeholder={`Cube ${i + 1}`} aria-label={`Cube ${i + 1} (MPa)`} disabled={saving} />
          ))}
        </div>
        {strengths.length < MAX_CUBES && (
          <button type="button" className={ps.addCube} onClick={() => setTyped([...strengths, ""])} disabled={saving}>
            + Another cube
          </button>
        )}
        {avg !== null && (
          <p className={ps.cubeAverage}>
            Average <b>{avg} MPa</b>
            {share !== null ? ` · ${share}% of ${target}` : ""}
          </p>
        )}
        {error && (
          <p className={styles.sheetError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.sheetSave} onClick={() => void save()} disabled={saving || formBusy}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A poured pour's cubes in one line, for its card when folded: "7 days 31.2 MPa ✓ · 14 days due Fri 7 Nov". */
export function cubesLine(cubes: PourCubes, today = ghanaDay()): string {
  if (cubes.taken === null) return "Cubes: say how many were taken";
  return cubes.tests
    .map((t) => {
      if (t.average !== null) return `${t.age} days ${t.average} MPa${(shareOf(t.average, cubes.target) ?? 0) >= (t.age >= 28 ? 100 : (USUAL_SHARE[t.age] ?? 100)) ? " ✓" : " ⚠"}`;
      if (isDue(t, today)) return `${t.age} days ${t.due === today ? "due today" : "late"}`;
      return `${t.age} days ${dayInText(t.due)}`;
    })
    .join(" · ");
}
