import "server-only";
import bcrypt from "bcryptjs";

// 12 rounds balances brute-force cost against Vercel function latency --
// each hash/compare takes roughly 200-300ms at this setting.
const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
