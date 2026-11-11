"use client";

import { useState, useTransition } from "react";

import { cancelOwnVisit, changeOwnVisit } from "@/lib/actions/visit";
import { dayLabel, rangeLabel, slotDay, slotLabel, slotStartMs, type SlotKey, type VisitRow } from "@/lib/siteVisits/shared";
import buttonStyles from "../Button.module.css";
import f from "../ReserveForm.module.css";
import { SlotPicker } from "./SlotPicker";
import s from "./Visit.module.css";

/** The visitor's own page (/visit/manage, the link in their emails): change the time, cancel, or book again. */
export function ManageVisit({
  initial,
  id,
  token,
  free: initialFree,
  nowMs,
  address,
  mapUrl,
  whatsappHref,
}: {
  initial: VisitRow;
  id: string;
  token: string;
  free: SlotKey[];
  nowMs: number;
  address: string;
  mapUrl: string;
  whatsappHref: string;
}) {
  const [visit, setVisit] = useState<VisitRow>(initial);
  const [free, setFree] = useState<SlotKey[]>(initialFree);
  const [mode, setMode] = useState<"view" | "change" | "cancel">("view");
  const [slot, setSlot] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [newBooking, setNewBooking] = useState(false);
  const [pending, start] = useTransition();

  const start_ = slotStartMs(visit.slot) ?? 0;
  const upcoming = visit.status === "booked" && start_ > nowMs;
  const first = visit.name.split(/\s+/)[0] || visit.name;

  const save = () =>
    start(async () => {
      if (!slot) {
        setMessage({ text: "Please pick a day and a time.", tone: "error" });
        return;
      }
      const result = await changeOwnVisit(id, token, slot);
      if (result.ok) {
        setNewBooking(result.visit.id !== visit.id);
        setVisit(result.visit);
        setMode("view");
        setSlot("");
        setMessage({ text: result.message, tone: "ok" });
      } else {
        setFree((list) => list.filter((k) => k !== slot));
        setSlot("");
        setMessage({ text: result.message, tone: "error" });
      }
    });

  const cancel = () =>
    start(async () => {
      const result = await cancelOwnVisit(id, token);
      setMessage({ text: result.message, tone: result.ok ? "ok" : "error" });
      if (result.ok) {
        setVisit(result.visit);
        setMode("view");
      }
    });

  const heading = newBooking
    ? `You're booked again, ${first}.`
    : visit.status === "cancelled"
      ? `Your visit is cancelled, ${first}.`
      : visit.status === "missed"
        ? `Sorry we missed you, ${first}.`
        : visit.status === "came"
          ? `Thank you for visiting, ${first}.`
          : upcoming
            ? `Your site visit, ${first}.`
            : `Your visit has passed, ${first}.`;

  return (
    <div className={f.done}>
      <div className="eyebrow">Site visit</div>
      <h2 className={f.doneTitle}>{heading}</h2>
      {message && (
        <p className={message.tone === "error" ? f.formError : s.okMessage} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
      <dl className={s.facts}>
        <dt>{visit.status === "cancelled" ? "Was" : "When"}</dt>
        <dd>
          {dayLabel(slotDay(visit.slot))}, {rangeLabel(visit.slot)} <span className={s.muted}>(Accra time)</span>
        </dd>
        {(upcoming || newBooking) && (
          <>
            <dt>Where</dt>
            <dd>
              {address}.{" "}
              <a href={mapUrl} target="_blank" rel="noopener noreferrer">
                Open the map
              </a>
            </dd>
          </>
        )}
      </dl>
      {newBooking && <p className={f.doneLede}>We&rsquo;ve emailed you the details of your new visit, with its own link to change it.</p>}

      {!newBooking && mode === "view" && (
        <div className={f.doneActions}>
          {upcoming ? (
            <>
              <button type="button" className={`${buttonStyles.btn} ${buttonStyles.brass}`} onClick={() => (setMode("change"), setMessage(null))}>
                Change the time
              </button>
              <button type="button" className={`${buttonStyles.btn} ${buttonStyles.outlineDark}`} onClick={() => (setMode("cancel"), setMessage(null))}>
                Cancel my visit
              </button>
            </>
          ) : (
            <button type="button" className={`${buttonStyles.btn} ${buttonStyles.brass}`} onClick={() => (setMode("change"), setMessage(null))}>
              {visit.status === "came" ? "Book another visit" : "Pick another time"}
            </button>
          )}
        </div>
      )}

      {mode === "cancel" && (
        <div className={s.confirm}>
          <p>Cancel your visit on {slotLabel(visit.slot)}?</p>
          <div className={f.doneActions}>
            <button type="button" disabled={pending} className={`${buttonStyles.btn} ${buttonStyles.clay}`} onClick={cancel}>
              {pending ? "Cancelling…" : "Yes, cancel it"}
            </button>
            <button type="button" disabled={pending} className={`${buttonStyles.btn} ${buttonStyles.outlineDark}`} onClick={() => setMode("view")}>
              Keep my visit
            </button>
          </div>
        </div>
      )}

      {mode === "change" && (
        <div className={s.changeBox}>
          <SlotPicker free={free} value={slot} nowMs={nowMs} onChange={setSlot} />
          <div className={f.doneActions}>
            <button type="button" disabled={pending} className={`${buttonStyles.btn} ${buttonStyles.clay}`} onClick={save}>
              {pending ? "Saving…" : upcoming ? "Move my visit" : "Book this time"}
            </button>
            <button type="button" disabled={pending} className={`${buttonStyles.btn} ${buttonStyles.outlineDark}`} onClick={() => (setMode("view"), setSlot(""))}>
              Back
            </button>
          </div>
        </div>
      )}

      <p className={f.note}>
        Questions?{" "}
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
          Message us on WhatsApp
        </a>
        .
      </p>
    </div>
  );
}
