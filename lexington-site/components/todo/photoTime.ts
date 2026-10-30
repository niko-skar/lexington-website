// When a phone photo was taken, for the concrete trucks (the waybill photo's time is when the truck reached the
// site). Read from the photo's own EXIF date before it's shrunk for upload (shrinking drops it); a photo with
// none falls back to the file's time, then to now.

import type { ArrivedFrom } from "@/lib/concrete/shared";

const ascii = (v: DataView, at: number, n: number) => {
  let s = "";
  for (let i = 0; i < n && at + i < v.byteLength; i++) {
    const c = v.getUint8(at + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
};

/** EXIF's "2026:10:30 10:52:07" (+ "+00:00" when the phone wrote its offset) as a time; no offset = this phone's own zone. */
function exifDate(text: string, offset: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const o = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  const at = o
    ? Date.UTC(y, mo - 1, d, h, mi, s) - (o[1] === "-" ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3])) * 60_000
    : new Date(y, mo - 1, d, h, mi, s).getTime();
  return Number.isNaN(at) ? null : new Date(at);
}

/** The date a JPEG says it was taken (DateTimeOriginal, else DateTime), or null. */
export async function photoTakenAt(file: Blob): Promise<Date | null> {
  const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (v.byteLength < 12 || v.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 <= v.byteLength) {
    const marker = v.getUint16(p);
    const size = v.getUint16(p + 2);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
    if (marker === 0xffe1 && ascii(v, p + 4, 4) === "Exif") return readTiff(v, p + 10);
    p += 2 + size;
  }
  return null;
}

function readTiff(v: DataView, tiff: number): Date | null {
  if (tiff + 8 > v.byteLength) return null;
  const little = v.getUint16(tiff) === 0x4949;
  const u16 = (at: number) => v.getUint16(at, little);
  const u32 = (at: number) => v.getUint32(at, little);
  // The ASCII tags of one directory: tag -> text.
  const tags = (dir: number) => {
    const out = new Map<number, string>();
    let exifDir = 0;
    if (dir + 2 > v.byteLength) return { out, exifDir };
    const count = u16(dir);
    for (let i = 0; i < count; i++) {
      const e = dir + 2 + i * 12;
      if (e + 12 > v.byteLength) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const n = u32(e + 4);
      if (tag === 0x8769) exifDir = tiff + u32(e + 8);
      else if (type === 2) out.set(tag, ascii(v, n <= 4 ? e + 8 : tiff + u32(e + 8), n));
    }
    return { out, exifDir };
  };
  const first = tags(tiff + u32(tiff + 4));
  const exif = first.exifDir ? tags(first.exifDir).out : new Map<number, string>();
  return exifDate(exif.get(0x9003) ?? first.out.get(0x0132) ?? "", exif.get(0x9011) ?? exif.get(0x9010) ?? "");
}

/**
 * The truck's arrival for a waybill photo: the photo's own time when it has one from the last three days, else
 * the file's time when that is older than a couple of minutes (a photo picked from the gallery), else now.
 */
export async function arrivalOf(file: File): Promise<{ at: string; from: ArrivedFrom }> {
  const now = Date.now();
  const fits = (t: number) => Number.isFinite(t) && t <= now + 2 * 60_000 && t >= now - 3 * 86_400_000;
  const taken = await photoTakenAt(file).catch(() => null);
  if (taken && fits(taken.getTime())) return { at: taken.toISOString(), from: "photo" };
  if (fits(file.lastModified) && now - file.lastModified > 2 * 60_000) return { at: new Date(file.lastModified).toISOString(), from: "file" };
  return { at: new Date(now).toISOString(), from: "now" };
}
