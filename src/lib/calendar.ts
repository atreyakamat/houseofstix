/**
 * The control room calendar: stall days, college events, coupon end dates and
 * anything else with a date. Pure functions only; saving lives in calendar-store.ts.
 */

export const KINDS = ["stall", "college", "coupon", "other"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = { stall: "Stall", college: "College event", coupon: "Coupon ends", other: "Other" };

export type CalEvent = {
  id: string;
  /** YYYY-MM-DD, the day it happens (the control room's local day, no time zone games). */
  date: string;
  /** Optional HH:MM start. */
  time?: string;
  title: string;
  kind: Kind;
  place?: string;
  notes?: string;
  /** Set on events brought in from the pop-up sheet, so a second import doesn't double them. */
  source?: string;
};

export type EventInput = Omit<CalEvent, "id">;

const LIMITS = { title: 120, place: 160, notes: 1000, source: 300 } as const;
export const MAX_EVENTS = 2000;

/** True for a real calendar day written YYYY-MM-DD. */
export function isDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const text = (v: unknown, field: keyof typeof LIMITS, required = false): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new Error(`${field} must be text`);
  const t = v.trim();
  if (!t) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (t.length > LIMITS[field]) throw new Error(`${field} is too long (max ${LIMITS[field]} characters)`);
  return t;
};

/** Checks what the browser sent and returns a clean event, or throws a message fit to show. */
export function validateEvent(raw: unknown): EventInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const date = typeof o.date === "string" ? o.date : "";
  if (!isDay(date)) throw new Error("date must be a real day (YYYY-MM-DD)");
  let time: string | undefined;
  if (o.time !== undefined && o.time !== null && o.time !== "") {
    if (typeof o.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(o.time)) throw new Error("time must be HH:MM");
    time = o.time;
  }
  const kind = (o.kind ?? "other") as Kind;
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  const ev: EventInput = { date, title: text(o.title, "title", true)!, kind };
  if (time) ev.time = time;
  const place = text(o.place, "place");
  const notes = text(o.notes, "notes");
  const source = text(o.source, "source");
  if (place) ev.place = place;
  if (notes) ev.notes = notes;
  if (source) ev.source = source;
  return ev;
}

/** Earliest first; events on the same day by time (all-day first), then title. */
export function sortEvents<T extends EventInput>(list: T[]): T[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
}

/** Events on or after `today`, soonest first. */
export function upcoming<T extends EventInput>(list: T[], today: string, n = 5): T[] {
  return sortEvents(list.filter((e) => e.date >= today)).slice(0, n);
}

/** Today as YYYY-MM-DD in local time. */
export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The days shown for a month: whole weeks, Monday first. `month` is 1-12.
 * Each cell is { day: YYYY-MM-DD, inMonth }.
 */
export function monthGrid(year: number, month: number): { day: string; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const total = Math.ceil((lead + daysIn) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    return { day: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === month - 1 };
  });
}

// ---- CSV import (the "Goa Sundays master" pop-up sheet) ----------------------

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (s[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const pick = (header: string[], ...names: string[]) => {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};

const cut = (v: string, max: number) => (v.length > max ? v.slice(0, max - 1) + "…" : v);

export type ImportResult = { events: EventInput[]; skipped: number; problems: string[] };

/**
 * Reads a pop-up sheet exported as CSV. Needs a date column ("Sunday" or "Date")
 * and a name column ("Event" or "Title"). A date cell may hold several days
 * ("2026-11-01 / 2026-11-08"): one event each. Rows marked Skip, or with no real
 * date, are left out. Venue, status, next step and fee go into place and notes.
 */
export function eventsFromCsv(csv: string): ImportResult {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { events: [], skipped: 0, problems: ["The file has no rows under the header."] };
  const [header, ...body] = rows;
  const col = {
    date: pick(header, "sunday", "date", "day"),
    title: pick(header, "event", "title", "name"),
    place: pick(header, "venue / town", "venue", "place", "location"),
    type: pick(header, "type", "kind"),
    status: pick(header, "status"),
    todo: pick(header, "do this", "next step"),
    fee: pick(header, "stall fee", "fee"),
    contact: pick(header, "contact / instagram / facebook", "contact"),
    dates: pick(header, "event dates"),
  };
  if (col.date < 0 || col.title < 0) {
    return { events: [], skipped: 0, problems: ['The header needs a date column ("Sunday" or "Date") and a name column ("Event" or "Title").'] };
  }
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const events: EventInput[] = [];
  const problems: string[] = [];
  let skipped = 0;
  body.forEach((r, n) => {
    const title = get(r, col.title);
    const status = get(r, col.status);
    if (!title || /^skip/i.test(status)) return void skipped++;
    const days = (get(r, col.date).match(/\d{4}-\d{2}-\d{2}/g) ?? []).filter(isDay);
    if (!days.length) {
      skipped++;
      problems.push(`Row ${n + 2} (${cut(title, 40)}): no date I can read, left out.`);
      return;
    }
    const type = get(r, col.type);
    const kind: Kind = /college|school|fest of|campus|university/i.test(`${title} ${type}`) ? "college" : "stall";
    const notes = [
      status && `Status: ${status}`,
      get(r, col.dates) && `Runs: ${get(r, col.dates)}`,
      get(r, col.todo) && `Next: ${get(r, col.todo)}`,
      get(r, col.fee) && `Fee: ${get(r, col.fee)}`,
      get(r, col.contact) && `Contact: ${get(r, col.contact)}`,
    ]
      .filter(Boolean)
      .join("\n");
    for (const date of [...new Set(days)]) {
      const ev: EventInput = { date, title: cut(title, LIMITS.title), kind, source: cut(`csv:${title}`, LIMITS.source) };
      const place = get(r, col.place);
      if (place) ev.place = cut(place, LIMITS.place);
      if (notes) ev.notes = cut(notes, LIMITS.notes);
      events.push(ev);
    }
  });
  return { events, skipped, problems };
}

/** Same day and same source (or same title when there's no source) counts as the same event. */
export const sameEvent = (a: EventInput, b: EventInput) => a.date === b.date && (a.source && b.source ? a.source === b.source : a.title === b.title);

// ---- .ics export (opens in Google Calendar, Apple Calendar, Outlook) ---------

const icsText = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines over 75 octets are folded as RFC 5545 asks. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) {
      out.push(cur);
      cur = " " + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

const compact = (day: string) => day.replace(/-/g, "");
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** A calendar file. Timed events last an hour unless you change them in your calendar app. */
export function toIcs(list: CalEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//House of Stix//Calendar//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:House of Stix"];
  for (const e of sortEvents(list)) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}@houseofstix`, `DTSTAMP:${stamp}`);
    if (e.time) {
      const [h, m] = e.time.split(":").map(Number);
      const endH = String(Math.min(h + 1, 23)).padStart(2, "0");
      const endM = h + 1 > 23 ? "59" : String(m).padStart(2, "0");
      lines.push(`DTSTART:${compact(e.date)}T${e.time.replace(":", "")}00`, `DTEND:${compact(e.date)}T${endH}${endM}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`);
    }
    lines.push(`SUMMARY:${icsText(`${e.title}`)}`, `CATEGORIES:${icsText(KIND_LABEL[e.kind])}`);
    if (e.place) lines.push(`LOCATION:${icsText(e.place)}`);
    if (e.notes) lines.push(`DESCRIPTION:${icsText(e.notes)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
