// Phone photos for the site to-do list: shrunk on the phone (fast on site data), then stored.

const LONG_SIDE = 1600;

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number }> {
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

/** A phone photo as a JPEG at most 1600 px on its long side (fast on site data). */
export async function shrink(file: File): Promise<Blob> {
  const { source, width, height } = await decode(file);
  const scale = Math.min(1, LONG_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo could not be read."))), "image/jpeg", 0.82)
  );
}

/** Shrinks and uploads one photo; resolves to the stored photo's id and address. */
export async function uploadPhoto(file: File): Promise<{ id: string; url: string }> {
  let blob: Blob = file;
  try {
    blob = await shrink(file);
  } catch {
    // Couldn't read it here: send it as it is (the server still checks the type and size).
  }
  const form = new FormData();
  form.append("photo", blob, "photo.jpg");
  let response: Response;
  try {
    response = await fetch("/api/todo/photo", { method: "POST", body: form });
  } catch {
    throw new Error("No signal: the photo didn't upload. Try again when you have data.");
  }
  const data = (await response.json().catch(() => ({}))) as { id?: string; url?: string; error?: string };
  if (!response.ok || !data.id || !data.url) throw new Error(data.error || "The photo didn't upload. Try again.");
  return { id: data.id, url: data.url };
}

/** A photo that was taken and then removed before saving: tidy it away (nothing else uses it). */
export function forgetPhoto(id: string) {
  void fetch(`/api/todo/photo?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
}
