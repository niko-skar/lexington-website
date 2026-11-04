// Phone photos for the site app: shrunk on the phone (fast on site data), then stored. Niko, 3 Nov 2026: "Photos I
// think need to be optimized as it takes a long time for them to upload from my phone, or at least it should load
// fast in my phone and upload in the background": the store's and the jobs' photos are smaller now, and a form can
// be saved while its photo is still on its way (photoQueue.ts).

/** A PDF (a supplier's bill or an expense's receipt can be one): sent as it is. */
export const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** Where photos go: the to-do list's, the store room's, the waybills', the suppliers' bills (a PDF will do there). */
export type PhotoEndpoint = "/api/todo/photo" | "/api/store/photo" | "/api/concrete/photo" | "/api/suppliers/photo";

/** Longest side and JPEG quality for each: papers (waybills, bills) stay sharp enough to read. */
const SIZES: Record<PhotoEndpoint, { side: number; quality: number }> = {
  "/api/todo/photo": { side: 1280, quality: 0.74 },
  "/api/store/photo": { side: 1280, quality: 0.74 },
  "/api/concrete/photo": { side: 1600, quality: 0.82 },
  "/api/suppliers/photo": { side: 1600, quality: 0.82 },
};

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    // Older Safari: an <img> decodes what createImageBitmap won't.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** A phone photo as a JPEG at most `side` px on its long side (fast on site data). */
export async function shrink(file: Blob, side = 1600, quality = 0.82): Promise<Blob> {
  return (await shrinkSized(file, side, quality)).blob;
}

/** As shrink(), with the photo's own size (a pre-pour photo's original keeps it on record). */
export async function shrinkSized(file: Blob, side: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { source, width, height } = await decode(file);
  const scale = Math.min(1, side / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source && typeof source.close === "function") source.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo could not be read."))), "image/jpeg", quality)
  );
  return { blob, width, height };
}

/** The photo as small as its use allows; as it is when the phone can't read it, or a PDF (the server still checks it). */
export async function shrinkFor(file: Blob, endpoint: PhotoEndpoint): Promise<Blob> {
  if (file instanceof File && isPdf(file)) return new Blob([file], { type: "application/pdf" });
  const { side, quality } = SIZES[endpoint];
  try {
    return await shrink(file, side, quality);
  } catch {
    return file;
  }
}

/** A failed upload: `status` 0 is no signal (worth trying again), 4xx a refusal that won't change. */
export class PhotoError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** Sends one (already shrunk) photo, with the ticket the server knows it by; resolves to its id and address. */
export async function sendPhoto(blob: Blob, endpoint: PhotoEndpoint, ticket?: string): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append("photo", blob, blob.type === "application/pdf" ? "bill.pdf" : "photo.jpg");
  if (ticket) form.append("ticket", ticket);
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new PhotoError("No signal: the photo didn't upload yet.", 0);
  }
  const data = (await response.json().catch(() => ({}))) as { id?: string; url?: string; error?: string };
  if (!response.ok || !data.id || !data.url) throw new PhotoError(data.error || "The photo didn't upload. Try again.", response.status || 500);
  return { id: data.id, url: data.url };
}

/** Shrinks and uploads one photo, waiting for it; resolves to the stored photo's id and address. */
export async function uploadPhoto(file: File, endpoint: PhotoEndpoint = "/api/todo/photo"): Promise<{ id: string; url: string }> {
  return sendPhoto(await shrinkFor(file, endpoint), endpoint);
}

/** A photo that was taken and then removed before saving: tidy it away (nothing else uses it). */
export function forgetPhoto(id: string, endpoint: PhotoEndpoint = "/api/todo/photo") {
  void fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
}
