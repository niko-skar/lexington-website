import "server-only";

import type { MetaConfig } from "./meta";

/**
 * One call to Meta's Graph API with the ad account key (META_ADS_ACCESS_TOKEN), for the
 * agents that change adverts (the ads autopilot and the ads manager). The key goes in a
 * header; a POST sends its fields as a form. A refusal throws a MetaError in Meta's words,
 * marked `permission` when the key isn't allowed (or is no longer valid), so a run stops
 * trying further changes at once.
 */

export class MetaError extends Error {
  /** The key isn't allowed to do this (or is no longer valid): no point trying more changes. */
  readonly permission: boolean;
  constructor(message: string, permission: boolean) {
    super(message);
    this.permission = permission;
  }
}

export async function metaGraph<T>(config: MetaConfig, method: "GET" | "POST", path: string, params: Record<string, string>): Promise<T> {
  const url = `${config.base}/${config.version}/${path}`;
  const query = new URLSearchParams(params);
  const response = await fetch(method === "GET" ? `${url}?${query}` : url, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(method === "POST" && { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    body: method === "POST" ? query.toString() : undefined,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | ({ error?: { message?: string; code?: number; error_user_msg?: string; error_user_title?: string } } & T)
    | null;
  if (!response.ok || body?.error) {
    const error = body?.error;
    const message = error?.error_user_msg || error?.message || `Meta answered ${response.status}`;
    const code = error?.code ?? 0;
    // 190: the key is no longer valid; 10 and 200-299: not allowed.
    const permission = code === 190 || code === 10 || (code >= 200 && code < 300) || /permission|not authori[sz]ed/i.test(message);
    throw new MetaError(message, permission);
  }
  return body as T;
}
