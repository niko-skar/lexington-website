import { vatNote, type Vat } from "@/lib/vat";

import styles from "./Vat.module.css";

/** " incl. VAT" after a price (shown with the VAT in it) while VAT is on (see lib/vat.ts). */
export function VatTag({ vat }: { vat: Vat }) {
  if (!vat.on) return null;
  return (
    <>
      {" "}
      <span className={styles.tag}>incl. VAT</span>
    </>
  );
}

/** "VAT included" after the reservation fee while VAT is on (the fee has VAT in it, see lib/vat.ts). */
export function VatIncluded({ vat }: { vat: Vat }) {
  if (!vat.on) return null;
  return (
    <>
      {" "}
      <span className={styles.included}>VAT included</span>
    </>
  );
}

/**
 * " excl. VAT" after a price that has no VAT in it: a buyer's own prices on their plans page when the account says so
 * (planOptions.exclVat; Niko, 19 Nov 2026, for Armstrong's lock-off: "update the prices to say excl VAT").
 */
export function VatExcluded() {
  return (
    <>
      {" "}
      <span className={styles.tag}>excl. VAT</span>
    </>
  );
}

/** One line under a list of prices. */
export function VatNote({ vat, className }: { vat: Vat; className?: string }) {
  const note = vatNote(vat);
  if (!note) return null;
  return <p className={className ?? styles.note}>{note}</p>;
}
