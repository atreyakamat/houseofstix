import { toIcs } from "@/lib/calendar";
import { bad, guard } from "@/lib/calendar-http";
import { listEvents } from "@/lib/calendar-store";

export const dynamic = "force-dynamic";

/** GET /api/calendar/ics -> house-of-stix.ics, to open in a phone or Google calendar. */
export async function GET(req: Request) {
  const stop = await guard(req);
  if (stop) return stop;
  try {
    return new Response(toIcs(await listEvents()), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="house-of-stix.ics"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return bad(e, 500);
  }
}
