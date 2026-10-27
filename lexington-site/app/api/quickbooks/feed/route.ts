import { after } from "next/server";

import { CATEGORIES, METHODS } from "@/lib/expenses/shared";
import { clearGone, feedPending, loadFeedSettings, PAY_TYPES, qboLists, saveFeedSettings, type Category, type Method } from "@/lib/quickbooks/feed";
import { classField, payField, RULE_ROWS } from "@/lib/quickbooks/feedForm";
import { backToPage, guard } from "@/lib/quickbooks/routes";
import { loadConnection, writeLog } from "@/lib/quickbooks/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/quickbooks/feed: the buttons of the expenses feed on /admin/quickbooks.
 * action = save (the accounts and the start date) | on | off | send (catch up now) | done (an entry removed by hand).
 */
export async function POST(request: Request): Promise<Response> {
  const refused = await guard(request, true);
  if (refused) return refused;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return backToPage(request, { err: "feed" });
  }
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const action = text("action");

  try {
    if (action === "done") {
      await clearGone(text("id"));
      return backToPage(request, { ok: "done" });
    }

    const conn = await loadConnection();
    if (!conn || conn.status !== "connected") return backToPage(request, { err: "feed-company" });
    const settings = await loadFeedSettings();

    if (action === "off") {
      await saveFeedSettings({ ...settings, enabled: false, updatedBy: "Admin" });
      await writeLog({ action: "feed", ok: true, httpStatus: null, intuitTid: null, message: "Expenses feed switched off." });
      return backToPage(request, { ok: "off" });
    }

    if (action === "on") {
      const complete = settings.startDate && settings.expenseAccount && Object.values(settings.payFrom).some(Boolean);
      if (!complete) return backToPage(request, { err: "feed-incomplete" });
      if (settings.realmId !== conn.realmId) return backToPage(request, { err: "feed-company" });
      await saveFeedSettings({ ...settings, enabled: true, updatedBy: "Admin" });
      await writeLog({ action: "feed", ok: true, httpStatus: null, intuitTid: null, message: `Expenses feed switched on (entries from ${settings.startDate}).` });
      after(() => feedPending(25));
      return backToPage(request, { ok: "on" });
    }

    if (action === "send") {
      const result = await feedPending(25);
      return backToPage(request, { ok: "sent" }, { n: String(result.sent), f: String(result.failed), w: String(result.waiting) });
    }

    if (action === "save") {
      const startDate = text("startDate");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate + "T00:00:00Z")) || startDate < "2020-01-01") {
        return backToPage(request, { err: "feed-date" });
      }
      const lists = await qboLists();
      const account = (id: string, payOnly: boolean) => {
        if (!id) return null;
        const found = lists.accounts.find((a) => a.id === id);
        if (!found || PAY_TYPES.includes(found.type) !== payOnly) throw new Error("account");
        return found.id;
      };
      const named = (id: string, list: { id: string }[]) => {
        if (!id) return null;
        if (!list.some((x) => x.id === id)) throw new Error("account");
        return id;
      };
      let next;
      try {
        next = {
          ...settings,
          startDate,
          payFrom: Object.fromEntries(METHODS.map((m) => [m, account(text(payField(m)), true)])) as Record<Method, string | null>,
          expenseAccount: account(text("expenseAccount"), false),
          classFor: Object.fromEntries(CATEGORIES.map((c) => [c, named(text(classField(c)), lists.classes)])) as Record<Category, string | null>,
          location: named(text("location"), lists.locations),
          inflowRules: Array.from({ length: RULE_ROWS }, (_, i) => ({ match: text(`rule_match_${i}`).slice(0, 60), account: text(`rule_account_${i}`) }))
            .filter((r) => r.match && r.account)
            .map((r) => ({ match: r.match, account: account(r.account, false) as string })),
          realmId: conn.realmId,
          updatedBy: "Admin",
        };
      } catch {
        return backToPage(request, { err: "feed-account" });
      }
      await saveFeedSettings(next);
      return backToPage(request, { ok: "saved" });
    }

    return backToPage(request, { err: "feed" });
  } catch (error) {
    await writeLog({ action: "feed", ok: false, httpStatus: null, intuitTid: null, message: `Feed button "${action}" failed: ${error instanceof Error ? error.message : String(error)}` });
    return backToPage(request, { err: "feed" });
  }
}
