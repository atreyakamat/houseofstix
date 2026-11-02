import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE = "hos_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

const sha = (v: string) => createHash("sha256").update(v).digest();

/** Settings the login needs. Null when the control room isn't set up, so it stays closed instead of open. */
export function authConfig(env: Record<string, string | undefined> = process.env) {
  const password = env.HOUSE_PASSWORD ?? "";
  const secret = env.HOUSE_SECRET ?? "";
  return password.length >= 8 && secret.length >= 32 ? { password, secret } : null;
}

/** Constant-time password check (both sides hashed so lengths match). */
export function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha(given), sha(expected));
}

const mac = (exp: string, secret: string) => createHmac("sha256", secret).update(`hos.${exp}`).digest("base64url");

export function signSession(secret: string, now = Date.now()): string {
  const exp = String(Math.floor(now / 1000) + SESSION_SECONDS);
  return `${exp}.${mac(exp, secret)}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig, ...rest] = token.split(".");
  if (!exp || !sig || rest.length || !/^\d+$/.test(exp)) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(exp, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(exp) * 1000 > now;
}

/** At most `limit` tries per `windowMs` per key. In memory: fine for one container. */
export function makeLimiter(limit = 5, windowMs = 60_000) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    hits.set(key, [...recent, now]);
    return true;
  };
}
