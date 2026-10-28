import { formatUSD } from "@/lib/format";
import { NO_VAT, withVat, type Vat } from "@/lib/vat";

// Parking and storage, as the Residences page lists them. Kept here (not in the
// page) because the lead responder quotes the same lines: one list, so a price
// changed on the page can never be quoted the old way in a reply. The amounts are
// before VAT; while VAT is on the lines show them with the VAT in it (lib/vat.ts).
export function extrasFor(vat: Vat = NO_VAT) {
  const usd = (amount: number) => formatUSD(withVat(amount, vat));
  return [
    { key: "parking-lift", label: "Parking", title: `Covered parking near lifts — ${usd(5000)}/space, purchased in pairs` },
    { key: "parking-compound", label: "Parking", title: "Compound parking included — 1 space for 1BR, 2 for 2BR+" },
    { key: "storage-bq", label: "Storage", title: `Boys' quarters — ${usd(1250)}/sqm (8–12 sqm units)` },
    { key: "storage-unit", label: "Storage", title: `Storage units — ${usd(1200)}/sqm (4–12 sqm units)` },
  ];
}
