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

/**
 * Who the login limiter counts tries for. X-Forwarded-For is only believed when
 * TRUST_PROXY=1 (a reverse proxy in front sets it). Without a proxy anyone can
 * send that header with a new made-up address on every try and dodge the limit,
 * so all direct tries share one bucket instead.
 */
export function limiterKey(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  if (env.TRUST_PROXY !== "1") return "direct";
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "proxy";
}

/**
 * True when a state-changing request comes from this site's own page. Browsers
 * send Origin on every POST; a page on another site can't fake it. Requests with
 * no Origin at all (curl, scripts) are allowed: they carry no visitor's cookie.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
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
