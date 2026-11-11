import { COOKIE, sameOrigin } from "@/lib/auth";

export function POST(req: Request) {
  // Another site can't sign you out by posting here.
  if (!sameOrigin(req)) return Response.json({ ok: false }, { status: 403 });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` },
  });
}
