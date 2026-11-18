// Unit sizes are kept in square metres (the unit the contracts use). Visitors can see them in square feet instead; these
// helpers do the converting and the wording, so every page writes a size the same way.

export type AreaUnit = "sqm" | "sqft";

export const SQFT_PER_SQM = 10.7639;

// "138 sqm" or "1,485 sq ft" (square feet rounded to the nearest whole one).
export function formatArea(sqm: number, unit: AreaUnit = "sqm") {
  return unit === "sqft" ? `${Math.round(sqm * SQFT_PER_SQM).toLocaleString("en-US")} sq ft` : `${sqm} sqm`;
}

// A price per square metre as a price per the visitor's unit: "$150" per sqm, or "$13.94" per sq ft (to the cent, so it
// still multiplies out to the same total).
export function formatRatePerArea(ratePerSqm: number, unit: AreaUnit = "sqm") {
  if (unit === "sqm") return `$${ratePerSqm.toLocaleString("en-US")}`;
  return `$${(ratePerSqm / SQFT_PER_SQM).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// How much of a home's listed size is balcony, when its record says so (0 when it does not).
export function balconyOf(home: { areaSqm: number; balconySqm?: number | null }) {
  const b = home.balconySqm;
  return typeof b === "number" && b > 0 && b < home.areaSqm ? b : 0;
}

// How much of a home's listed size is roof terrace, when its record says so (0 when it does not). PH2b, 18 Nov 2026.
export function terraceOf(home: { areaSqm: number; balconySqm?: number | null; terraceSqm?: number | null }) {
  const t = home.terraceSqm;
  return typeof t === "number" && t > 0 && t + balconyOf(home) < home.areaSqm ? t : 0;
}

// A home's listed size split into the inside, the balcony and the roof terrace: { internal: "31 sqm", balcony: "2 sqm",
// terrace: "0 sqm" }. In square feet the inside is the total less the outside parts, so they always add up to the size the
// list shows.
export function splitArea(totalSqm: number, balconySqm: number, unit: AreaUnit = "sqm", terraceSqm = 0) {
  if (unit === "sqm") return { internal: formatArea(totalSqm - balconySqm - terraceSqm), balcony: formatArea(balconySqm), terrace: formatArea(terraceSqm) };
  const total = Math.round(totalSqm * SQFT_PER_SQM);
  const balcony = Math.round(balconySqm * SQFT_PER_SQM);
  const terrace = Math.round(terraceSqm * SQFT_PER_SQM);
  const feet = (v: number) => `${v.toLocaleString("en-US")} sq ft`;
  return { internal: feet(total - balcony - terrace), balcony: feet(balcony), terrace: feet(terrace) };
}

export function areaUnitLabel(unit: AreaUnit) {
  return unit === "sqft" ? "sq ft" : "sqm";
}
