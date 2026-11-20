"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, type AnchorHTMLAttributes, type ReactNode } from "react";

// Where the CRM's screens are shown (19 Nov 2026): on the admin pages (/admin/crm, each prospect its own page, the server
// drawing a page again after a change), or inside the app's Customers part (/todo/customers, everything in one page:
// links open a prospect in place, and the part reads the CRM again after each change). The screens ask this instead of
// knowing their addresses.

export interface CrmView {
  /** The prospect to open; none = the lists. */
  id?: string;
  /** The list's tab (today, waiting, pipeline, all) and the All list's stage filter. */
  view?: string;
  stage?: string;
}

export interface CrmHostApi {
  inApp: boolean;
  /** The office: makes buyer logins and deletes prospects (a login of the app with Customers doesn't). */
  office: boolean;
  /** A login with Customers (Rahma's): its account id, whose list is its own (none for the office). */
  me?: string;
  /** A prospect's address, for the link (a long-press, a new tab). */
  leadHref: (id: string) => string;
  /** The lists' address. */
  listHref: (to?: Omit<CrmView, "id">) => string;
  /** In the app: opens a prospect or a list in place. */
  go?: (to: CrmView) => void;
  /** In the app: reads the CRM again after a change and waits for it (the admin pages are drawn again by the server). */
  refresh: () => Promise<void>;
}

const listQuery = (to?: Omit<CrmView, "id">) => {
  const q = new URLSearchParams();
  if (to?.view) q.set("view", to.view);
  if (to?.stage) q.set("stage", to.stage);
  const s = q.toString();
  return s ? `?${s}` : "";
};

const ADMIN: CrmHostApi = {
  inApp: false,
  office: true,
  leadHref: (id) => `/admin/crm/${id}`,
  listHref: (to) => `/admin/crm${listQuery(to)}`,
  refresh: async () => {},
};

/** The app's addresses for the same screens. */
export const appListHref = (to?: Omit<CrmView, "id">) => `/todo/customers${listQuery(to)}`;

const Context = createContext<CrmHostApi>(ADMIN);

export function CrmHostProvider({ value, children }: { value: CrmHostApi; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCrmHost(): CrmHostApi {
  return useContext(Context);
}

/** Marks a change sent from the app (lib/crmAccess.ts fromApp): the server then leaves the admin pages alone. */
export function markFromApp(host: CrmHostApi, data: FormData) {
  if (host.inApp) data.set("inApp", "1");
}

/** For a form posted straight to an action: the same mark, as a hidden field. */
export function FromAppField() {
  return useCrmHost().inApp ? <input type="hidden" name="inApp" value="1" /> : null;
}

/**
 * A form action (useActionState) that, in the app, is marked as from the app and is followed by the CRM read again,
 * before the form says it's done. On the admin pages it's the action itself.
 */
export function useHostAction<S>(action: (prev: S, data: FormData) => Promise<S>): (prev: S, data: FormData) => Promise<S> {
  const host = useCrmHost();
  const inApp = host.inApp;
  const refresh = host.refresh;
  const wrapped = useCallback(
    async (prev: S, data: FormData) => {
      data.set("inApp", "1");
      const result = await action(prev, data);
      await refresh().catch(() => undefined);
      return result;
    },
    [action, refresh]
  );
  return inApp ? wrapped : action;
}

/** Runs a change from a button: marked in the app, then the CRM read again (in the app) before it's over. */
export async function runChange<T>(host: CrmHostApi, action: (data: FormData) => Promise<T>, data: FormData): Promise<T> {
  markFromApp(host, data);
  const result = await action(data);
  if (host.inApp) await host.refresh().catch(() => undefined);
  return result;
}

type AnchorBits = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick" | "children">;

/** A link to a prospect: their page on the admin pages, opened in place in the app. */
export function LeadLink({
  id,
  children,
  onClick,
  ...rest
}: {
  id: string;
  children: ReactNode;
  onClick?: () => void;
} & AnchorBits) {
  const host = useCrmHost();
  if (!host.go) {
    return (
      <Link href={host.leadHref(id)} onClick={onClick} {...rest}>
        {children}
      </Link>
    );
  }
  const go = host.go;
  return (
    <a
      href={host.leadHref(id)}
      {...rest}
      onClick={(e) => {
        onClick?.();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go({ id });
      }}
    >
      {children}
    </a>
  );
}

/** A link to the lists (a tab, a filter): its page on the admin pages, in place in the app. */
export function ListLink({ to, className, children }: { to?: Omit<CrmView, "id">; className?: string; children: ReactNode }) {
  const host = useCrmHost();
  if (!host.go) {
    return (
      <Link href={host.listHref(to)} className={className}>
        {children}
      </Link>
    );
  }
  const go = host.go;
  return (
    <a
      href={host.listHref(to)}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go({ ...to });
      }}
    >
      {children}
    </a>
  );
}
