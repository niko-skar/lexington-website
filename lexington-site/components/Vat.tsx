import { formatUSD } from "@/lib/format";
import { vatAmount, vatNote, withVat, type Vat } from "@/lib/vat";

import styles from "./Vat.module.css";

/** " + VAT" after a price while VAT is on (see lib/vat.ts). */
export function VatTag({ vat }: { vat: Vat }) {
  if (!vat.on) return null;
  return (
    <>
      {" "}
      <span className={styles.tag}>+ VAT</span>
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

/** Under a unit's price: the VAT and what the buyer pays in all. */
export function VatTotal({ price, vat }: { price: number; vat: Vat }) {
  if (!vat.on) return null;
  return (
    <span className={styles.total}>
      VAT {vat.rate}% {formatUSD(vatAmount(price, vat))} · Total {formatUSD(withVat(price, vat))}
    </span>
  );
}

/** One line under a list of prices. */
export function VatNote({ vat, className }: { vat: Vat; className?: string }) {
  const note = vatNote(vat);
  if (!note) return null;
  return <p className={className ?? styles.note}>{note}</p>;
}
