/**
 * VAT on the prices. Niko, 28 Oct 2026: "we have to start adding VAT to the prices on the website", first
 * shown as "Price + VAT", then the same day "I want the full amount of vat added everywhere we show a
 * price": every price people see has the VAT in it, labelled "incl. VAT". The prices kept in Sanity stay
 * before VAT; withVat() makes the price that is shown. His accountant confirmed 20% (VAT 15% + NHIL
 * 2.5% + GETFund 2.5%). One switch in Site settings → VAT.
 *
 * By law a price shown without a separate VAT line counts as including VAT (VAT Act 2025, s.44(5)),
 * so once the switch is on, every price must go through here.
 */

export interface Vat {
  on: boolean;
  /** Percent, e.g. 20. */
  rate: number;
}

export const NO_VAT: Vat = { on: false, rate: 0 };

/** The setting as stored in Site settings (vat.on, vat.rate). */
export interface VatSetting {
  on?: boolean | null;
  rate?: number | null;
}

/**
 * The VAT in force, from Site settings. A local or preview copy can show prices as if it were on
 * (VAT_TEST_RATE=20) without touching the live setting; production never reads that.
 */
export function vatFrom(settings?: { vat?: VatSetting | null } | null): Vat {
  const test = process.env.VERCEL_ENV !== "production" ? Number(process.env.VAT_TEST_RATE) : NaN;
  if (test > 0 && test <= 50) return { on: true, rate: test };
  const v = settings?.vat;
  const rate = Number(v?.rate);
  return v?.on === true && rate > 0 && rate <= 50 ? { on: true, rate } : NO_VAT;
}

/** The VAT on a price, to the whole dollar (0 when VAT is off). */
export function vatAmount(price: number, vat: Vat): number {
  return vat.on ? Math.round((price * vat.rate) / 100) : 0;
}

/** What the buyer pays in all: the price plus its VAT. Every price shown goes through this. */
export function withVat(price: number, vat: Vat): number {
  return price + vatAmount(price, vat);
}

/** " incl. VAT" to follow a price that has the VAT in it (or nothing while VAT is off). */
export function inclVatSuffix(vat: Vat): string {
  return vat.on ? " incl. VAT" : "";
}

/**
 * The reservation fee is a set amount with VAT already in it (Niko, 28 Oct 2026: "the reservation
 * fee includes vat"), so it never takes "+ VAT": " (VAT included)" follows it while VAT is on.
 */
export function feeVatSuffix(vat: Vat): string {
  return vat.on ? " (VAT included)" : "";
}

/** One line for under a list of prices, or "" while VAT is off. */
export function vatNote(vat: Vat): string {
  return vat.on ? `Prices are in US dollars and include VAT at ${vat.rate}%.` : "";
}

/** For the card pictures' address: changes when the switch or the rate changes. */
export function vatKey(vat: Vat): string {
  return vat.on ? `incl${vat.rate}` : "novat";
}
