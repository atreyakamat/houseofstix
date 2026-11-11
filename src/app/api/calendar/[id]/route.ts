import { validateEvent } from "@/lib/calendar";
import { bad, guard, noStore, readJson } from "@/lib/calendar-http";
import { deleteEvent, updateEvent } from "@/lib/calendar-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const gone = () => Response.json({ error: "That event isn't on the calendar any more" }, { status: 404 });

/** PUT /api/calendar/:id { event: {...} } -> replaces the event. */
export async function PUT(req: Request, { params }: Ctx) {
  const stop = await guard(req, true);
  if (stop) return stop;
  const { id } = await params;
  try {
    const body = (await readJson(req)) as { event?: unknown };
    const event = await updateEvent(id, validateEvent(body?.event));
    return event ? Response.json({ event }, { headers: noStore }) : gone();
  } catch (e) {
    return bad(e);
  }
}

/** DELETE /api/calendar/:id */
export async function DELETE(req: Request, { params }: Ctx) {
  const stop = await guard(req, true);
  if (stop) return stop;
  const { id } = await params;
  try {
    return (await deleteEvent(id)) ? Response.json({ ok: true }, { headers: noStore }) : gone();
  } catch (e) {
    return bad(e, 500);
  }
}
