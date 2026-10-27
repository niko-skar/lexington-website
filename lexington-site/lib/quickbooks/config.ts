import "server-only";

// The website's own connection to The Lexington's QuickBooks Online company (Niko, 27 Oct 2026:
// expenses entered in the site app should go into QuickBooks without retyping). Intuit's own
// Claude connector is US-only, so this is our private Intuit app "Lexington Books" instead.
//
// Keys come from the Intuit developer portal (workspace "The Lexington", app "Lexington Books"):
// development keys only open a practice ("sandbox") company, production keys the real one.

export type QboEnvironment = "sandbox" | "production";

export interface QboKeys {
  clientId: string;
  clientSecret: string;
  environment: QboEnvironment;
}

/** The keys, or null while they are not set (the page then says what is missing). */
export function qboKeys(): QboKeys | null {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID?.trim();
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const environment: QboEnvironment = process.env.QUICKBOOKS_ENV === "production" ? "production" : "sandbox";
  return { clientId, clientSecret, environment };
}

/** Only the books: no payments, payroll or profile scopes. */
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";

/** Intuit retired every minor version below 75 in 2025. */
export const QBO_MINOR_VERSION = 75;

export function qboApiBase(environment: QboEnvironment): string {
  return environment === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
}

export interface QboEndpoints {
  authorization: string;
  token: string;
  revocation: string;
}

// Intuit's published addresses, used only when the discovery document can't be fetched.
const FALLBACK: QboEndpoints = {
  authorization: "https://appcenter.intuit.com/connect/oauth2",
  token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};

const DISCOVERY: Record<QboEnvironment, string> = {
  sandbox: "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
  production: "https://developer.api.intuit.com/.well-known/openid_configuration",
};

const discovered = new Map<QboEnvironment, { at: number; endpoints: QboEndpoints }>();
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

/** The sign-in, token and revoke addresses from Intuit's discovery document (cached for a day). */
export async function qboEndpoints(environment: QboEnvironment): Promise<QboEndpoints> {
  const hit = discovered.get(environment);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.endpoints;
  try {
    const res = await fetch(DISCOVERY[environment], { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`discovery ${res.status}`);
    const doc = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string; revocation_endpoint?: string };
    const endpoints: QboEndpoints = {
      authorization: doc.authorization_endpoint || FALLBACK.authorization,
      token: doc.token_endpoint || FALLBACK.token,
      revocation: doc.revocation_endpoint || FALLBACK.revocation,
    };
    discovered.set(environment, { at: Date.now(), endpoints });
    return endpoints;
  } catch (error) {
    console.error("[quickbooks] discovery document failed, using the published addresses:", error instanceof Error ? error.message : error);
    return FALLBACK;
  }
}

/** Where Intuit sends the browser back after sign-in. Must be listed on the app's Redirect URIs. */
export function qboRedirectUri(requestUrl: string): string {
  const fixed = process.env.QUICKBOOKS_REDIRECT_URI?.trim();
  if (fixed) return fixed;
  return new URL("/api/quickbooks/callback", requestUrl).toString();
}
