import { probe, type Probe } from "@/lib/probe";
import { disabledIds, loadServices } from "@/lib/services";
import { isSignedIn } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/status -> { checkedAt, services: { [id]: { state, ms?, code? } } }. Signed in only. */
export async function GET() {
  if (!(await isSignedIn())) return Response.json({ error: "Sign in first" }, { status: 401 });
  let list;
  try {
    list = loadServices();
  } catch {
    return Response.json({ error: "services.yaml has a problem" }, { status: 500 });
  }
  const off = disabledIds();
  const results = await Promise.all(list.map(async (s) => [s.id, off.has(s.id) ? ({ state: "off" } as Probe) : await probe(s)] as const));
  return Response.json({ checkedAt: new Date().toISOString(), services: Object.fromEntries(results) as Record<string, Probe> }, { headers: { "Cache-Control": "no-store" } });
}
