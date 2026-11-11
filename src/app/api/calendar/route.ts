import { eventsFromCsv, validateEvent } from "@/lib/calendar";
import { bad, guard, noStore, readJson } from "@/lib/calendar-http";
import { addEvent, importEvents, listEvents } from "@/lib/calendar-store";

export const dynamic = "force-dynamic";

/** GET /api/calendar -> { events }. Signed in only. */
export async function GET(req: Request) {
  const stop = await guard(req);
  if (stop) return stop;
  try {
    return Response.json({ events: await listEvents() }, { headers: noStore });
  } catch (e) {
    console.error("[calendar] read failed:", e);
    return bad(new Error("Couldn't read the calendar file on the box."), 500);
  }
}

/**
 * POST /api/calendar
 *   { event: {...} }  -> adds one event
 *   { csv: "..." }    -> imports a pop-up sheet (CSV), skipping days already on the calendar
 */
export async function POST(req: Request) {
  const stop = await guard(req, true);
  if (stop) return stop;
  let body: { event?: unknown; csv?: unknown };
  try {
    body = (await readJson(req)) as typeof body;
  } catch (e) {
    return bad(e);
  }
  try {
    if (typeof body?.csv === "string") {
      const { events, skipped, problems } = eventsFromCsv(body.csv);
      if (!events.length && problems.length) return bad(new Error(problems[0]));
      const { added, already } = await importEvents(events);
      return Response.json({ added, already, skipped, problems: problems.slice(0, 10) }, { headers: noStore });
    }
    const event = await addEvent(validateEvent(body?.event));
    return Response.json({ event }, { status: 201, headers: noStore });
  } catch (e) {
    return bad(e);
  }
}
