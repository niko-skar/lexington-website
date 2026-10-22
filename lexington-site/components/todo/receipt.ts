// Receipts for the expenses: a photo (shrunk on the phone first, like the to-do photos) or a PDF.
import { shrink } from "./photo";

export const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** Uploads one receipt; resolves to the stored file's id, address and type. */
export async function uploadReceipt(file: File): Promise<{ id: string; url: string; type: string }> {
  const pdf = isPdf(file);
  let blob: Blob = pdf ? new Blob([file], { type: "application/pdf" }) : file;
  if (!pdf) {
    try {
      blob = await shrink(file);
    } catch {
      // Couldn't read it here: send it as it is (the server still checks the type and size).
    }
  }
  const form = new FormData();
  form.append("file", blob, pdf ? "receipt.pdf" : "receipt.jpg");
  let response: Response;
  try {
    response = await fetch("/api/expenses/receipt", { method: "POST", body: form });
  } catch {
    throw new Error("No signal: the receipt didn't upload. Try again when you have data.");
  }
  const data = (await response.json().catch(() => ({}))) as { id?: string; url?: string; type?: string; error?: string };
  if (!response.ok || !data.id || !data.url) throw new Error(data.error || "The receipt didn't upload. Try again.");
  return { id: data.id, url: data.url, type: data.type || (pdf ? "application/pdf" : "image/jpeg") };
}

/** A receipt added and then removed before saving: tidy it away (nothing else uses it). */
export function forgetReceipt(id: string) {
  void fetch(`/api/expenses/receipt?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
}
