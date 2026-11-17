"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { notifyOwner } from "@/lib/alerts/notify";
import { requireCurrentBuyer } from "@/lib/auth/currentBuyer";
import { VIEW_ONLY_MESSAGE } from "@/lib/auth/portalView";
import { noteOnLead } from "@/lib/crmIntake";
import { formatUSD } from "@/lib/format";
import { planPickerSetup, portalDay } from "@/lib/planOptions";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import type { PlanChoice } from "@/lib/sanity/buyersTypes";

// "Confirm my selection" on a buyer's homes to pick from (Niko, 17 Nov 2026: a buyer swapping one of his studios
// chooses among the available ones, "once he's happy with his selection he can click a button and I can get
// notified"). The selection is saved on the account as it was shown (planOptions.chosen), a note and a task go on
// the buyer's CRM record, and Niko's phone buzzes. Nothing else changes: the website, the account's homes and price
// and the agreement stay Niko's to update. Sending a different selection later replaces the first and tells him again.

export interface PickConfirmState {
  status: "ok" | "error";
  message?: string;
  /** What is now saved as sent. */
  keys?: string[];
  at?: string;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));
const newKey = () => randomBytes(6).toString("hex");

export async function confirmPlanPicksAction(picked: string[]): Promise<PickConfirmState> {
  // `plansPage`: a buyer kept to the plans page may press the button too.
  const { buyer, viewing } = await requireCurrentBuyer({ plansPage: true });
  if (viewing) return { status: "error", message: VIEW_ONLY_MESSAGE };
  const { picks, confirm } = planPickerSetup(buyer);
  if (!confirm) return { status: "error", message: "A selection can't be sent from this page. Please contact us." };

  const asked = Array.isArray(picked) ? [...new Set(picked.filter((k): k is string => typeof k === "string"))] : [];
  const homes = picks.filter((p) => asked.includes(p.key)); // in the page's order
  const allStudios = picks.every((p) => p.group === "studio");
  const one = allStudios ? "studio" : "home";
  if (homes.length === 0 || homes.length !== asked.length) {
    return { status: "error", message: "The page has changed since you opened it. Please reload it and choose again." };
  }
  if (confirm.count && homes.length !== confirm.count) {
    return { status: "error", message: `Please select ${confirm.count} ${one}${confirm.count === 1 ? "" : "s"}, then confirm.` };
  }

  const keys = homes.map((p) => p.key);
  const before = buyer.planOptions?.chosen;
  // The same selection again (a second tap, another tab): it is already with Niko.
  if (confirm.sent && sameSet(confirm.sent.keys, keys)) return { status: "ok", keys: confirm.sent.keys, at: confirm.sent.at };
  if (before?.at && Date.now() - Date.parse(before.at) < 20_000) {
    return { status: "error", message: "We have just received your selection. Please wait a moment before sending a new one." };
  }

  const now = new Date().toISOString();
  const totalUSD = homes.reduce((sum, p) => sum + p.priceUSD, 0);
  const chosen: PlanChoice = {
    at: now,
    keys,
    homes: homes.map((p) => ({
      _key: newKey(),
      title: p.title,
      ...(p.floorLabel ? { floorLabel: p.floorLabel } : {}),
      ...(p.unitNumber ? { unitNumber: p.unitNumber } : {}),
      ...(p.listPriceUSD !== null ? { listPriceUSD: p.listPriceUSD } : {}),
      priceUSD: p.priceUSD,
    })),
    totalUSD,
  };
  try {
    await getBuyersClient().patch(buyer._id).set({ "planOptions.chosen": chosen }).commit();
  } catch (err) {
    console.error("[plan picks] could not save a selection:", err instanceof Error ? err.message : err);
    return { status: "error", message: "Sorry, something went wrong sending your selection. Please try again, or contact us." };
  }

  // Tell Niko: a note and a task on the buyer's CRM record, and a phone alert. Neither may fail the buyer's send.
  const names = homes.map((p) => p.unitNumber || p.title).join(" + ");
  const lines = [
    ...homes.map((p) => `${p.title}${p.floorLabel ? `, ${p.floorLabel.toLowerCase()}` : ""}: ${formatUSD(p.priceUSD)}${p.listPriceUSD !== null && p.listPriceUSD > p.priceUSD ? ` (list ${formatUSD(p.listPriceUSD)})` : ""}`),
    `Total at their prices: ${formatUSD(totalUSD)}`,
    ...(before?.at && before.homes?.length ? [`This replaces what they sent on ${portalDay(before.at)}: ${before.homes.map((h) => h.unitNumber || h.title).join(" + ")}.`] : []),
    `On their account now: ${buyer.unitNumber || "no home"}, ${formatUSD(buyer.contractPriceUSD)}.`,
    "Nothing else has changed: the website, their account and the agreement are yours to update.",
  ];
  let leadId: string | null = null;
  try {
    leadId = await getBuyersClient().fetch<string | null>(`*[_type == "lead" && lower(email) == $email][0]._id`, { email: buyer.email.toLowerCase() });
  } catch {
    leadId = null;
  }
  if (leadId) {
    await noteOnLead(leadId, `${buyer.name} confirmed a selection from the buyer portal: ${names}, ${formatUSD(totalUSD)} at their prices.`, {
      text: `Update the website, the account and the agreement for ${buyer.name}'s selection (${names})`,
      dueInDays: 1,
      waitingOn: "me",
    });
  }
  await notifyOwner({
    kind: "buyer",
    urgent: true,
    title: `${buyer.name} confirmed their ${one}${homes.length === 1 ? "" : "s"}: ${names}`,
    lines,
    links: [...(leadId ? [{ label: "Open their record", url: `/admin/crm/${leadId}` }] : []), { label: "Their buyer account", url: `/admin/${buyer._id}` }],
  });

  revalidatePath("/account", "layout");
  return { status: "ok", keys, at: now };
}
