// What someone answered, written out in plain words: for the sales email and for
// the prospect's notes in the CRM. Pure, so it can be tested without a server.

import { formatFloor, formatUSD } from "@/lib/format";
import {
  BUYING_AS,
  CONTACT_VIA,
  HEARD,
  PAYMENTS,
  PURPOSES,
  TIMELINES,
  UNSURE_TYPE,
  VIEWINGS,
  labelOf,
  unitTypeFor,
} from "./config";
import type { ReservationInput } from "./validate";

export interface UnitFacts {
  unitNumber: string;
  bedroomType: string;
  floor: number;
  areaSqm: number;
  /** As the website shows it. */
  priceUSD: number;
  /** The price has the VAT in it (VAT on). */
  vatIncluded?: boolean;
}

/** "Unit 205B, One bedroom" / "One bedroom (we'll confirm the unit)" / "We'll recommend a residence". */
export function residenceText(input: ReservationInput, unit: UnitFacts | null) {
  const type = unitTypeFor(unit?.bedroomType ?? input.unitType);
  if (unit) return `Unit ${unit.unitNumber}, ${type?.fact ?? unit.bedroomType}`;
  if (type) return `${type.fact} (we'll confirm the unit with you)`;
  return "We'll recommend a residence for you";
}

export function interestText(input: ReservationInput, unit: UnitFacts | null) {
  const type = unitTypeFor(unit?.bedroomType ?? input.unitType);
  if (unit) return `Reservation: unit ${unit.unitNumber} (${type?.fact ?? unit.bedroomType})`;
  if (type) return `Reservation: ${type.fact} (unit not chosen)`;
  return "Reservation: wants advice on which residence";
}

export function answerRows(input: ReservationInput, unit: UnitFacts | null): Array<[string, string]> {
  const type = unitTypeFor(unit?.bedroomType ?? input.unitType);
  const residence = unit
    ? `Unit ${unit.unitNumber}: ${type?.fact ?? unit.bedroomType}, ${
        unit.floor === 0 ? "ground floor" : `floor ${formatFloor(unit.floor)}`
      }, ${unit.areaSqm} sqm, list price ${formatUSD(unit.priceUSD)}${unit.vatIncluded ? " incl. VAT" : ""}`
    : type
      ? `${type.fact}, unit not chosen yet`
      : input.unitType === UNSURE_TYPE
        ? "Not sure: wants us to recommend one"
        : "—";

  const buyingAs =
    (labelOf(BUYING_AS, input.buyingAs) ?? "—") +
    (input.coBuyer ? ` (${input.coBuyer})` : "") +
    (input.company ? ` (${input.company})` : "");

  const advert = [input.utm.source, input.utm.medium, input.utm.campaign, input.utm.content].filter(Boolean).join(" / ");

  const rows: Array<[string, string]> = [
    ["Name", input.name],
    ["Email", input.email],
    ["Phone / WhatsApp", input.phone],
    ["Lives in", [input.city, input.country].filter(Boolean).join(", ")],
    ["Prefers to be reached by", labelOf(CONTACT_VIA, input.contactVia) ?? "—"],
    ["Residence", residence],
    ["It is for", labelOf(PURPOSES, input.purpose) ?? "—"],
    ["Wants to reserve", labelOf(TIMELINES, input.timeline) ?? "—"],
    ["Viewing", labelOf(VIEWINGS, input.viewing) ?? "—"],
    ["Plans to pay", labelOf(PAYMENTS, input.payment) ?? "—"],
    ["Buying as", buyingAs],
    ["Heard about us from", labelOf(HEARD, input.heard) ?? "—"],
    ["Message", input.note || "—"],
  ];
  if (advert) rows.push(["Came from the link", advert]);
  return rows;
}

/** The prospect's note: starts with "Reservation request" (the daily limit counts those). */
export function crmSummary(input: ReservationInput, unit: UnitFacts | null) {
  const lines = answerRows(input, unit)
    .filter(([label]) => label !== "Name" && label !== "Email")
    .map(([label, value]) => `${label}: ${value}`);
  return `Reservation request on the website.\n${lines.join("\n")}`;
}
