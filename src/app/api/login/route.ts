import { authConfig, COOKIE, limiterKey, makeLimiter, passwordMatches, sameOrigin, SESSION_SECONDS, signSession } from "@/lib/auth";

// 10 tries a minute per visitor behind a proxy, or for all direct visitors together.
const allow = makeLimiter(10, 60_000);

export async function POST(req: Request) {
  const cfg = authConfig();
  if (!cfg) return Response.json({ ok: false }, { status: 503 });
  if (!sameOrigin(req)) return Response.json({ ok: false }, { status: 403 });
  if (!allow(limiterKey(req.headers))) return Response.json({ ok: false }, { status: 429 });

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body.password === "string") password = body.password.slice(0, 200);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!passwordMatches(password, cfg.password)) return Response.json({ ok: false }, { status: 401 });

  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const cookie = `${COOKIE}=${signSession(cfg.secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`;
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": cookie } });
}
