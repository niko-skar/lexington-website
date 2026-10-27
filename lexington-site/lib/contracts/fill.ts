import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// The buyer's own blanks in a sale agreement, filled in from what they type on the buyer portal
// (Niko, 27 Oct 2026: "give her the space to input that and automatically update the contract with
// her information"). When a contract is drawn up, the office also keeps a "fill-in copy" of it: the
// same Word file with a marker in place of each blank that belongs to the buyer. The portal fills
// the markers in that copy and the result becomes the buyer's draft. Everything else stays as it
// is, including the Seller's own blanks, which stay highlighted for the office to complete.

export const MARKERS = {
  citizenship: "{{BUYER_CITIZENSHIP}}",
  idType: "{{BUYER_ID_TYPE}}",
  idNumber: "{{BUYER_ID_NUMBER}}",
  address: "{{BUYER_ADDRESS}}",
  citizenshipKeyTerms: "{{BUYER_CITIZENSHIP_KEY_TERMS}}",
  noticeAddress: "{{BUYER_NOTICE_ADDRESS}}",
  emergencyName: "{{EMERGENCY_NAME}}",
  emergencyAddress: "{{EMERGENCY_ADDRESS}}",
  emergencyContact: "{{EMERGENCY_CONTACT}}",
} as const;

export interface BuyerDetailsInput {
  citizenOfGhana: boolean;
  /** Required when not a citizen of Ghana; a second citizenship otherwise. */
  otherCitizenship: string;
  idType: "ghana-card" | "passport";
  idNumber: string;
  /** The country that issued the passport. */
  idCountry: string;
  address: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyAddress: string;
  emergencyEmail: string;
  emergencyPhone: string;
}

/** How each answer reads in the contract, by marker. */
export function markerValues(d: BuyerDetailsInput): Record<string, string> {
  const other = d.otherCitizenship.trim();
  const passport = d.idType === "passport";
  const contact = [d.emergencyEmail.trim(), d.emergencyPhone.trim()].filter(Boolean).join(" / ");
  return {
    [MARKERS.citizenship]: d.citizenOfGhana
      ? other
        ? `a citizen of the Republic of Ghana and of ${other}`
        : "a citizen of the Republic of Ghana"
      : `a citizen of ${other}`,
    [MARKERS.citizenshipKeyTerms]: d.citizenOfGhana
      ? other
        ? `Ghanaian (also a citizen of ${other})`
        : "Ghanaian"
      : `Not Ghanaian: citizen of ${other}`,
    [MARKERS.idType]: passport ? "Passport" : "Ghana Card",
    [MARKERS.idNumber]: passport && d.idCountry.trim() ? `${d.idNumber.trim()} (issued by ${d.idCountry.trim()})` : d.idNumber.trim(),
    [MARKERS.address]: d.address,
    [MARKERS.noticeAddress]: d.address,
    [MARKERS.emergencyName]: d.emergencyRelationship.trim() ? `${d.emergencyName.trim()} (${d.emergencyRelationship.trim()})` : d.emergencyName.trim(),
    [MARKERS.emergencyAddress]: d.emergencyAddress.trim() || "Not given",
    [MARKERS.emergencyContact]: contact,
  };
}

const xmlText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** One run of text in the Word file (<w:r>), never crossing into the next one. */
const RUN = /<w:r(?: [^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g;

/**
 * Fills the markers of a fill-in copy. Each marker sits in its own run, which also loses the
 * yellow highlight that marks a blank. Answers which markers were filled and which were not in the file.
 */
export function fillContract(docx: Uint8Array, values: Record<string, string>) {
  const files = unzipSync(docx);
  const part = "word/document.xml";
  if (!files[part]) throw new Error("Not a Word file: no word/document.xml.");
  let xml = strFromU8(files[part]);
  const filled: string[] = [];
  const missing: string[] = [];
  for (const [marker, value] of Object.entries(values)) {
    if (!xml.includes(marker)) {
      missing.push(marker);
      continue;
    }
    xml = xml.replace(RUN, (run) =>
      run.includes(marker) ? run.split(marker).join(xmlText(value)).replace(/<w:highlight [^>]*\/>/g, "") : run
    );
    filled.push(marker);
  }
  files[part] = strToU8(xml);
  return { bytes: zipSync(files, { level: 6 }), filled, missing };
}
