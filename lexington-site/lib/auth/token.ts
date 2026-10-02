import { jwtVerify, SignJWT } from "jose";

// Pure sign/verify helpers with no next/headers dependency, so this file
// can be imported from middleware.ts (Edge runtime) as well as from
// Server Actions/Components (Node runtime). bcrypt never runs here --
// password comparison only ever happens inside a Server Action.

export type SessionRole = "buyer" | "admin";

export interface SessionPayload {
  role: SessionRole;
  email?: string;
  /** Set only at login, from the account's role in the buyers dataset -- lets a
   *  buyer-portal login for an admin account also open /admin. */
  isAdmin?: boolean;
}

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("Missing AUTH_SECRET -- required to sign/verify session cookies.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(payload: SessionPayload, expiresIn: string) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (payload.role !== "buyer" && payload.role !== "admin") return null;
    return {
      role: payload.role,
      email: typeof payload.email === "string" ? payload.email : undefined,
      isAdmin: payload.isAdmin === true,
    };
  } catch {
    // Expired, tampered, or malformed -- treat exactly like "not logged in"
    // rather than throwing, so a stale cookie never crashes a page.
    return null;
  }
}
