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

export function areaUnitLabel(unit: AreaUnit) {
  return unit === "sqft" ? "sq ft" : "sqm";
}
