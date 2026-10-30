/**
 * Brings the site roll call over from its Claude page ("Site Roll Call") into the site app (/todo/rollcall),
 * 30 Oct 2026: every record exactly as it was (workers, days, payments, pours, checklists, settings), and the
 * photos it points at (ID cards, curing found dry) into the website's own image store.
 *
 * It reads a copy of the page's database (one folder per kind: workers/<id>.json, days/<date>.json, ...) and a
 * folder of the page's photos named by their old id (<id>.jpg|png|webp). Every record keeps its id, so the
 * pay worked out from them is the same.
 *
 *   npx tsx --env-file=.env.local scripts/import-rollcall.ts "<data folder>" "<photos folder>"            test copy ("rc-dev-")
 *   npx tsx --env-file=.env.local scripts/import-rollcall.ts "<data folder>" "<photos folder>" --live     the real roll call
 *   ... --dry   says what it would do and writes nothing
 *
 * The real roll call is only written while it is empty, unless --replace is given too (the move is once;
 * after it, the website's records are the real ones and a second run would overwrite a day's marks).
 */
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@sanity/client";

const COLLECTIONS = ["workers", "days", "payments", "pours", "checklists", "config"] as const;
type Data = Record<string, unknown>;

const [dataDir, photoDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const LIVE = process.argv.includes("--live");
const DRY = process.argv.includes("--dry");
const REPLACE = process.argv.includes("--replace");
if (!dataDir || !photoDir) {
  console.error('Usage: npx tsx --env-file=.env.local scripts/import-rollcall.ts "<data folder>" "<photos folder>" [--live] [--dry] [--replace]');
  process.exit(1);
}
const PREFIX = LIVE ? "rc-live-" : "rc-dev-";
const KEY_RE = /^[A-Za-z0-9_.-]{1,100}$/;

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET,
  token: process.env.SANITY_BUYERS_API_TOKEN,
  apiVersion: "2024-06-01",
  useCdn: false,
});

function readRecords(): Array<{ col: (typeof COLLECTIONS)[number]; key: string; data: Data }> {
  const out: Array<{ col: (typeof COLLECTIONS)[number]; key: string; data: Data }> = [];
  for (const col of COLLECTIONS) {
    const dir = path.join(dataDir, col);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const key = file.slice(0, -5);
      if (!KEY_RE.test(key)) throw new Error(`Odd record name: ${col}/${file}`);
      out.push({ col, key, data: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Data });
    }
  }
  return out;
}

// Where the page's records point at a photo: a worker's ID card, and each time a pour was found dry.
function photoRefs(records: ReturnType<typeof readRecords>): Array<{ get: () => string; set: (id: string) => void }> {
  const refs: Array<{ get: () => string; set: (id: string) => void }> = [];
  for (const r of records) {
    if (r.col === "workers" && typeof r.data.idPhoto === "string") refs.push({ get: () => r.data.idPhoto as string, set: (id) => (r.data.idPhoto = id) });
    if (r.col === "pours" && r.data.dry && typeof r.data.dry === "object") {
      for (const x of Object.values(r.data.dry as Record<string, Data | null>)) {
        if (x && typeof x.photo === "string") refs.push({ get: () => x.photo as string, set: (id) => (x.photo = id) });
      }
    }
  }
  return refs;
}

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

async function main() {
  const records = readRecords();
  const count = (col: string) => records.filter((r) => r.col === col).length;
  console.log(`${records.length} records: ${COLLECTIONS.map((c) => `${count(c)} ${c}`).join(", ")} -> ${PREFIX}*`);

  const existing = await client.fetch<number>(`count(*[_type == "rollcallDoc" && string::startsWith(_id, $prefix)])`, { prefix: PREFIX });
  if (LIVE && existing && !REPLACE) {
    console.error(`The real roll call already has ${existing} records: not touching it (add --replace only if that's really meant).`);
    process.exit(1);
  }

  // Photos: each old id once, into the image store; the records then point at the new ids.
  const refs = photoRefs(records);
  const files = fs.existsSync(photoDir) ? fs.readdirSync(photoDir) : [];
  const moved = new Map<string, string>();
  const missing: string[] = [];
  for (const old of [...new Set(refs.map((r) => r.get()))]) {
    if (old.startsWith("image-")) continue; // already in the website's store
    const file = files.find((f) => f.startsWith(old + "."));
    if (!file || !TYPES[path.extname(file).toLowerCase()]) {
      missing.push(old);
      continue;
    }
    if (DRY) {
      moved.set(old, `image-(new for ${old})`);
      continue;
    }
    const asset = await client.assets.upload("image", fs.readFileSync(path.join(photoDir, file)), {
      filename: `rollcall-moved-${old}${path.extname(file).toLowerCase()}`,
      contentType: TYPES[path.extname(file).toLowerCase()],
    });
    moved.set(old, asset._id);
  }
  for (const r of refs) {
    const to = moved.get(r.get());
    if (to) r.set(to);
  }
  console.log(`photos: ${moved.size} moved${missing.length ? `, ${missing.length} not found (left as they were): ${missing.join(", ")}` : ""}`);

  if (DRY) {
    console.log("--dry: nothing written.");
    return;
  }
  for (let i = 0; i < records.length; i += 40) {
    const tx = client.transaction();
    for (const r of records.slice(i, i + 40)) {
      tx.createOrReplace({ _id: `${PREFIX}${r.col}--${r.key}`, _type: "rollcallDoc", col: r.col, key: r.key, json: JSON.stringify(r.data), by: "Moved from the Claude page" });
    }
    await tx.commit();
  }
  const after = await client.fetch<number>(`count(*[_type == "rollcallDoc" && string::startsWith(_id, $prefix)])`, { prefix: PREFIX });
  console.log(`written: ${records.length}; ${PREFIX}* records now: ${after}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
