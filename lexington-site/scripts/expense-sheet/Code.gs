/**
 * @OnlyCurrentDoc
 *
 * Lexington site expenses -> this Google Sheet, with every receipt saved in Google Drive under a
 * name that traces back to its entry ("2026-10-23 EXP-0084 Kalushia Hardware GHS 5,430.00 VAT.jpg").
 * The website (lexington.com.gh/todo/expenses) sends each new, changed or deleted entry here.
 *
 * Drive: My Drive / Lexington expense receipts / Receipts / 2026-10
 *                                             / VAT receipts / 2026-10
 *                                             / Deleted (receipts of deleted or replaced entries)
 *
 * Set up once (in this sheet): Extensions > Apps Script, paste this file, Save, then
 * Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone > Deploy, allow it,
 * and send the "Web app" address to Claude. Nothing is written without the secret below.
 */

const SECRET = "PASTE-SECRET-HERE";
const SHEET_NAME = "Expenses";
const ROOT_FOLDER = "Lexington expense receipts";

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: "Not JSON" });
  }
  if (!req || req.secret !== SECRET) return out({ ok: false, error: "Wrong secret" });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return out({ ok: false, error: "Busy, try again" });
  try {
    if (req.action === "upsert") return out(upsert(req));
    if (req.action === "delete") return out(markDeleted(req));
    if (req.action === "ping") return out({ ok: true, sheetUrl: SpreadsheetApp.getActive().getUrl() });
    return out({ ok: false, error: "Unknown action" });
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

/** Opening the web app address in a browser just says hello (nothing is read or written). */
function doGet() {
  return out({ ok: true, hello: "Lexington expenses sheet" });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- the sheet ---------- */

function expensesSheet(columns) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME, 0);
    const first = ss.getSheets()[1];
    if (first && first.getName() === "Sheet1" && first.getLastRow() === 0) ss.deleteSheet(first);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(columns);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, columns.length).setFontWeight("bold");
  }
  // Columns added later by the website go on the end; columns added by hand are left alone.
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const missing = columns.filter((c) => head.indexOf(c) < 0);
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
  }
  return sh;
}

function header(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function findRow(sh, id) {
  if (!id || sh.getLastRow() < 2) return 0;
  const col = header(sh).indexOf("ID") + 1;
  if (col < 1) return 0;
  const hit = sh.getRange(2, col, sh.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

/** Text from the website never runs as a formula in the sheet. */
function safe(value) {
  return typeof value === "string" && /^[=+\-@]/.test(value) ? "'" + value : value;
}

function writeRow(sh, row) {
  const head = header(sh);
  const r = findRow(sh, row["ID"]);
  if (r) {
    const range = sh.getRange(r, 1, 1, head.length);
    const values = range.getValues()[0];
    const formulas = range.getFormulas()[0];
    const next = head.map((h, i) => (h in row ? row[h] : formulas[i] || values[i]));
    range.setValues([next]);
    return r;
  }
  sh.appendRow(head.map((h) => (h in row ? row[h] : "")));
  return sh.getLastRow();
}

/* ---------- Drive ---------- */

function rootFolder() {
  const props = PropertiesService.getScriptProperties();
  const known = props.getProperty("folder:root");
  if (known) {
    try {
      return DriveApp.getFolderById(known);
    } catch (err) {
      /* deleted by hand: make it again */
    }
  }
  const found = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER);
  const folder = found.hasNext() ? found.next() : DriveApp.getRootFolder().createFolder(ROOT_FOLDER);
  props.setProperty("folder:root", folder.getId());
  return folder;
}

/** A folder under the root by path, e.g. ["VAT receipts", "2026-10"], made if missing. */
function folderAt(path) {
  const props = PropertiesService.getScriptProperties();
  const key = "folder:" + path.join("/");
  const known = props.getProperty(key);
  if (known) {
    try {
      return DriveApp.getFolderById(known);
    } catch (err) {
      /* deleted by hand: make it again */
    }
  }
  let folder = rootFolder();
  for (const name of path) {
    const found = folder.getFoldersByName(name);
    folder = found.hasNext() ? found.next() : folder.createFolder(name);
  }
  props.setProperty(key, folder.getId());
  return folder;
}

function setAside(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).moveTo(folderAt(["Deleted"]));
  } catch (err) {
    /* already gone */
  }
}

function inFolder(file, folder) {
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folder.getId()) return true;
  return false;
}

/* ---------- actions ---------- */

/** Which Drive file holds each row's receipt, and which upload it came from (kept out of sight). */
function memoOf(id) {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty("row:" + id) || "{}");
  } catch (err) {
    return {};
  }
}
function remember(id, memo) {
  const props = PropertiesService.getScriptProperties();
  if (memo) props.setProperty("row:" + id, JSON.stringify(memo));
  else props.deleteProperty("row:" + id);
}
function fileIfThere(fileId) {
  if (!fileId) return null;
  try {
    return DriveApp.getFileById(fileId);
  } catch (err) {
    return null; // removed by hand
  }
}

function upsert(req) {
  const sh = expensesSheet(req.columns);
  const id = req.row["ID"];
  const row = {};
  Object.keys(req.row).forEach((k) => (row[k] = safe(req.row[k])));
  const month = String(req.row["Date"] || "").slice(0, 7) || "No date";
  const target = folderAt([req.folder === "VAT receipts" ? "VAT receipts" : "Receipts", month]);

  // One receipt file per row: the same upload sent twice (two saves close together) is kept once;
  // a new receipt replaces the old one, which is set aside rather than deleted.
  const memo = memoOf(id);
  let file = fileIfThere(memo.fileId || req.fileId);
  if (!req.receiptAssetId) {
    if (file) setAside(file.getId()); // the receipt was taken off the entry
    file = null;
  } else if (!(file && memo.assetId === req.receiptAssetId)) {
    if (req.file) {
      const blob = Utilities.newBlob(Utilities.base64Decode(req.file.data), req.file.mimeType, req.file.name);
      const fresh = target.createFile(blob);
      if (file) setAside(file.getId());
      file = fresh;
    } else if (!file) {
      return { ok: false, error: "The receipt file is missing: send it again" };
    }
  }
  if (file) {
    if (file.getName() !== req.fileName) file.setName(req.fileName);
    if (!inFolder(file, target)) file.moveTo(target);
  }
  remember(id, file ? { fileId: file.getId(), assetId: req.receiptAssetId } : null);

  const fileUrl = file ? file.getUrl() : null;
  row["Receipt"] = fileUrl ? '=HYPERLINK("' + fileUrl + '","Receipt")' : "";
  row["Receipt file"] = fileUrl ? safe(req.fileName) : "";
  const r = writeRow(sh, row);
  sh.getRange(r, 1, 1, sh.getLastColumn()).setFontColor(null).setFontLine("none");
  return { ok: true, fileId: file ? file.getId() : null, fileUrl: fileUrl, sheetUrl: SpreadsheetApp.getActive().getUrl() };
}

function markDeleted(req) {
  const sh = expensesSheet(["ID", "Status"]);
  const r = findRow(sh, req.id);
  if (r) {
    const head = header(sh);
    const status = head.indexOf("Status") + 1;
    if (status > 0) sh.getRange(r, status).setValue("Deleted");
    sh.getRange(r, 1, 1, sh.getLastColumn()).setFontColor("#9aa0a6").setFontLine("line-through");
  }
  setAside(memoOf(req.id).fileId || req.fileId);
  remember(req.id, null);
  return { ok: true };
}
