import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MAX_EVENTS, sameEvent, sortEvents, validateEvent, type CalEvent, type EventInput } from "./calendar";

/**
 * Calendar events live in one JSON file on the box: CALENDAR_FILE, or
 * data/calendar.json next to the app (a Docker volume in production, so it
 * survives rebuilds). Writes go to a temp file first and then replace the real
 * one, so a crash mid-save never leaves half a file.
 */
export const calendarFile = () => resolve(process.env.CALENDAR_FILE || resolve(process.cwd(), "data", "calendar.json"));

async function readAll(): Promise<CalEvent[]> {
  let raw: string;
  try {
    raw = await readFile(calendarFile(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const parsed: unknown = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : ((parsed as { events?: unknown[] })?.events ?? []);
  // Anything hand-edited into a bad shape is dropped instead of breaking the page.
  return list.flatMap((item) => {
    try {
      const id = (item as { id?: unknown }).id;
      if (typeof id !== "string" || !id) return [];
      return [{ id, ...validateEvent(item) }];
    } catch {
      return [];
    }
  });
}

async function writeAll(list: CalEvent[]) {
  const file = calendarFile();
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, events: sortEvents(list) }, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, file);
}

// One change at a time, so two quick saves can't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export const listEvents = () => locked(async () => sortEvents(await readAll()));

const roomFor = (list: CalEvent[], more: number) => {
  if (list.length + more > MAX_EVENTS) throw new Error(`The calendar is full (${MAX_EVENTS} events). Delete old ones first.`);
};

export const addEvent = (input: EventInput) =>
  locked(async () => {
    const list = await readAll();
    roomFor(list, 1);
    const ev: CalEvent = { id: randomUUID(), ...input };
    await writeAll([...list, ev]);
    return ev;
  });

export const updateEvent = (id: string, input: EventInput) =>
  locked(async () => {
    const list = await readAll();
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return null;
    const ev: CalEvent = { id, ...input };
    list[i] = ev;
    await writeAll(list);
    return ev;
  });

export const deleteEvent = (id: string) =>
  locked(async () => {
    const list = await readAll();
    const next = list.filter((e) => e.id !== id);
    if (next.length === list.length) return false;
    await writeAll(next);
    return true;
  });

/** Adds imported events, skipping ones already on the calendar. Returns how many were new. */
export const importEvents = (incoming: EventInput[]) =>
  locked(async () => {
    const list = await readAll();
    const fresh = incoming.filter((e, i) => !list.some((x) => sameEvent(x, e)) && !incoming.slice(0, i).some((x) => sameEvent(x, e)));
    roomFor(list, fresh.length);
    if (fresh.length) await writeAll([...list, ...fresh.map((e) => ({ id: randomUUID(), ...e }))]);
    return { added: fresh.length, already: incoming.length - fresh.length };
  });
