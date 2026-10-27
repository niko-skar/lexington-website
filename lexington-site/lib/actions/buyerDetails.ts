"use server";

import { revalidatePath } from "next/cache";

import { notifyOwner } from "@/lib/alerts/notify";
import { requireCurrentBuyer } from "@/lib/auth/currentBuyer";
import { fillContract, markerValues, type BuyerDetailsInput } from "@/lib/contracts/fill";
import { noteOnLead } from "@/lib/crmIntake";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

// The buyer's own details for their agreement, sent from the "Next steps" on the buyer portal
// (Niko, 27 Oct 2026): they are saved on the account, filled into the draft agreement (the
// fill-in copy's markers, lib/contracts/fill.ts), and Niko gets a phone alert plus a task on the
// buyer's CRM record. Sending again (to correct something) fills a fresh copy the same way.

export interface DetailsFormState {
  status: "idle" | "ok" | "error";
  message?: string;
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function text(formData: FormData, name: string, max: number) {
  const value = formData.get(name);
  // One line each, except the addresses and the comments (lines become ", " in the contract).
  return typeof value === "string" ? value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}
const oneLine = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/,$/, ""))
    .filter(Boolean)
    .join(", ");

export async function saveBuyerDetailsAction(_prev: DetailsFormState, formData: FormData): Promise<DetailsFormState> {
  const { buyer } = await requireCurrentBuyer();
  const draft = buyer.contractDraft;
  if (!draft?.fillBaseUrl) {
    return { status: "error", message: "There is nothing to fill in on your account yet. Please contact us." };
  }
  const last = buyer.buyerDetails?.submittedAt ? Date.parse(buyer.buyerDetails.submittedAt) : 0;
  if (Date.now() - last < 20_000) {
    return { status: "error", message: "We have just received your details. Please wait a moment before sending again." };
  }

  const citizen = text(formData, "citizenOfGhana", 3);
  const idType = text(formData, "idType", 12);
  const input: BuyerDetailsInput = {
    citizenOfGhana: citizen === "yes",
    otherCitizenship: text(formData, "otherCitizenship", 80),
    idType: idType === "passport" ? "passport" : "ghana-card",
    idNumber: text(formData, "idNumber", 40),
    idCountry: text(formData, "idCountry", 80),
    address: oneLine(text(formData, "address", 300)),
    emergencyName: text(formData, "emergencyName", 100),
    emergencyRelationship: text(formData, "emergencyRelationship", 60),
    emergencyAddress: oneLine(text(formData, "emergencyAddress", 300)),
    emergencyEmail: text(formData, "emergencyEmail", 120),
    emergencyPhone: text(formData, "emergencyPhone", 40),
  };
  const comments = text(formData, "comments", 2000);

  const missing: string[] = [];
  if (citizen !== "yes" && citizen !== "no") missing.push("whether you are a citizen of Ghana");
  if (citizen === "no" && !input.otherCitizenship) missing.push("your citizenship");
  if (idType !== "ghana-card" && idType !== "passport") missing.push("your ID document");
  if (!input.idNumber) missing.push("your ID number");
  if (idType === "passport" && !input.idCountry) missing.push("the country that issued your passport");
  if (!input.address) missing.push("your home address");
  if (!input.emergencyName) missing.push("your emergency contact's name");
  if (!input.emergencyEmail && !input.emergencyPhone) missing.push("an email or phone number for your emergency contact");
  if (formData.get("readDraft") !== "on") missing.push("a tick to say you have read the draft agreement");
  if (missing.length) return { status: "error", message: `Please add ${missing.join(", ")}.` };
  if (input.emergencyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.emergencyEmail)) {
    return { status: "error", message: "Please check your emergency contact's email address." };
  }

  // Fill the markers of the office's fill-in copy and make that the buyer's draft.
  let fileRef: { _type: "file"; asset: { _type: "reference"; _ref: string } };
  let fileUrl = "";
  let unfilled: string[] = [];
  try {
    const res = await fetch(draft.fillBaseUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`fill-in copy: HTTP ${res.status}`);
    const { bytes, missing: notInFile } = fillContract(new Uint8Array(await res.arrayBuffer()), markerValues(input));
    unfilled = notInFile;
    const surname = buyer.name.trim().split(/\s+/).pop()?.replace(/[^A-Za-z0-9-]/g, "") || "Buyer";
    const unit = (buyer.unitNumber || "").replace(/[^A-Za-z0-9-]/g, "");
    const asset = await getBuyersClient().assets.upload("file", Buffer.from(bytes), {
      filename: `Lexington_Unit_${unit}_Sale_Agreement_${surname}_DRAFT.docx`,
      contentType: DOCX,
    });
    fileRef = { _type: "file", asset: { _type: "reference", _ref: asset._id } };
    fileUrl = asset.url;
  } catch (err) {
    console.error("[buyer details] could not fill the agreement:", err instanceof Error ? err.message : err);
    return { status: "error", message: "Sorry, something went wrong saving your details. Please try again, or contact us." };
  }

  const now = new Date().toISOString();
  try {
    await getBuyersClient()
      .patch(buyer._id)
      .set({
        buyerDetails: { ...input, comments, submittedAt: now },
        "contractDraft.current": fileRef,
        "contractDraft.detailsAddedAt": now,
      })
      .commit();
  } catch (err) {
    console.error("[buyer details] could not save:", err instanceof Error ? err.message : err);
    return { status: "error", message: "Sorry, something went wrong saving your details. Please try again, or contact us." };
  }

  // Tell Niko: a task on the buyer's CRM record and a phone alert. Neither may fail the buyer's send.
  const first = buyer.name.trim().split(/\s+/)[0] || buyer.name;
  const values = markerValues(input);
  const lines = [
    `Citizenship: ${values["{{BUYER_CITIZENSHIP_KEY_TERMS}}"]}`,
    `ID: ${values["{{BUYER_ID_TYPE}}"]} No. ${values["{{BUYER_ID_NUMBER}}"]}`,
    `Address: ${input.address}`,
    `Emergency contact: ${values["{{EMERGENCY_NAME}}"]}, ${values["{{EMERGENCY_CONTACT}}"]}${input.emergencyAddress ? `, ${input.emergencyAddress}` : ""}`,
    comments ? `Questions or changes: ${comments}` : "No questions or changes.",
    "Their details are now in the draft agreement on their portal. Your own blanks (dates, bank details and so on) are still highlighted.",
    ...(unfilled.length ? [`Not found in the contract file, so not filled: ${unfilled.join(", ")}`] : []),
  ];
  let leadId: string | null = null;
  try {
    leadId = await getBuyersClient().fetch<string | null>(`*[_type == "lead" && lower(email) == $email][0]._id`, {
      email: buyer.email.toLowerCase(),
    });
  } catch {
    leadId = null;
  }
  if (leadId) {
    await noteOnLead(
      leadId,
      `${buyer.name} sent their details for the agreement from the buyer portal. ${lines.slice(0, 5).join(" | ")}`,
      { text: `Check ${first}'s details and fill in your side of the agreement`, dueInDays: 1, waitingOn: "me" }
    );
  }
  await notifyOwner({
    kind: "buyer",
    urgent: true,
    title: `${buyer.name} sent their details for the agreement${buyer.unitNumber ? ` (${buyer.unitNumber})` : ""}`,
    lines,
    links: [
      ...(fileUrl ? [{ label: "Open the updated draft", url: fileUrl }] : []),
      ...(leadId ? [{ label: "Open their record", url: `/admin/crm/${leadId}` }] : []),
      { label: "Their buyer account", url: `/admin/${buyer._id}` },
    ],
  });

  revalidatePath("/account", "layout");
  return { status: "ok", message: "Thank you. Your details are now in your draft agreement, and we have been notified." };
}
