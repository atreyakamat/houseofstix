import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eventsFromCsv, isDay, monthGrid, parseCsv, toIcs, upcoming, validateEvent, type CalEvent } from "@/lib/calendar";

vi.mock("server-only", () => ({}));

describe("validateEvent", () => {
  it("accepts a full event and trims text", () => {
    expect(validateEvent({ date: "2026-11-22", time: "10:30", title: "  Mapusa stall ", kind: "stall", place: "Mapusa", notes: "Bring QR" })).toEqual({
      date: "2026-11-22",
      time: "10:30",
      title: "Mapusa stall",
      kind: "stall",
      place: "Mapusa",
      notes: "Bring QR",
    });
  });
  it("defaults kind to other and drops empty optional fields", () => {
    expect(validateEvent({ date: "2026-12-25", title: "Xmas", time: "", place: " " })).toEqual({ date: "2026-12-25", title: "Xmas", kind: "other" });
  });
  it.each([
    [{ date: "2026-02-30", title: "x" }, /real day/],
    [{ date: "22/11/2026", title: "x" }, /real day/],
    [{ date: "2026-11-22", title: "" }, /title is required/],
    [{ date: "2026-11-22", title: "x", time: "25:00" }, /HH:MM/],
    [{ date: "2026-11-22", title: "x", kind: "party" }, /kind must be/],
    [{ date: "2026-11-22", title: "x".repeat(121) }, /too long/],
    [{ date: "2026-11-22", title: 5 }, /must be text/],
    [null, /real day/],
  ])("rejects %j", (input, msg) => {
    expect(() => validateEvent(input)).toThrow(msg);
  });
});

describe("dates", () => {
  it("knows real days", () => {
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2027-02-29")).toBe(false);
  });
  it("lays out whole Monday-first weeks", () => {
    const nov = monthGrid(2026, 11); // 1 Nov 2026 is a Sunday
    expect(nov.length % 7).toBe(0);
    expect(nov[0]).toEqual({ day: "2026-10-26", inMonth: false });
    expect(nov[6]).toEqual({ day: "2026-11-01", inMonth: true });
    expect(nov.filter((c) => c.inMonth)).toHaveLength(30);
    expect(nov.at(-1)?.day).toBe("2026-12-06");
  });
  it("lists what's coming up, soonest first, timed after all-day", () => {
    const list = [
      { date: "2026-11-01", title: "past", kind: "other" as const },
      { date: "2026-11-22", title: "b", kind: "stall" as const, time: "09:00" },
      { date: "2026-11-22", title: "a", kind: "stall" as const },
      { date: "2026-11-15", title: "c", kind: "college" as const },
    ];
    expect(upcoming(list, "2026-11-11").map((e) => e.title)).toEqual(["c", "a", "b"]);
  });
});

const SHEET = [
  "Sunday,Event,Event dates,Venue / town,Km from Mapusa,Type,Date status,Urgency,Do this,Contact / Instagram / Facebook,Stall fee,Sticker fit,Status,Source",
  '2026-11-01,Oktoberfest Goa 2026,Fri 30 Oct - Sun 1 Nov 2026,"Bandodkar Ground, Campal, Panaji",14,Beer fest,Confirmed,1,Ask for a stall,Via District,Not listed,Good,To contact,https://x',
  "2026-11-01 / 2026-11-08,Panjim Diwali street market,Before Diwali,Panjim,13,Festive stalls,Estimated,1,Call CCP,CCP,Not found,Medium,To contact,https://y",
  '2026-11-22,IFFI,20-28 Nov,Panaji,14,Film fest,Confirmed,5,"Skip: food only",ESG,"Rs 35,000",Over budget,Skip,https://z',
  "TBC (Dec),Christmas fair,Dec,Margao,30,Fair,Unknown,3,Watch,-,-,Good,Watching,https://w",
  "2026-12-06,St Xavier's College fest,6 Dec,Mapusa,0,College fest,Confirmed,2,DM the council,@xaviers,Rs 500,Great,To contact,https://v",
].join("\r\n");

describe("CSV import", () => {
  it("parses quotes, commas and doubled quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\n1,2,3\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });
  it("reads the Goa Sundays sheet: one event per date, Skip rows and undated rows left out", () => {
    const { events, skipped, problems } = eventsFromCsv(SHEET);
    expect(events.map((e) => [e.date, e.title, e.kind])).toEqual([
      ["2026-11-01", "Oktoberfest Goa 2026", "stall"],
      ["2026-11-01", "Panjim Diwali street market", "stall"],
      ["2026-11-08", "Panjim Diwali street market", "stall"],
      ["2026-12-06", "St Xavier's College fest", "college"],
    ]);
    expect(skipped).toBe(2);
    expect(problems).toEqual([expect.stringMatching(/Row 5 \(Christmas fair\)/)]);
    expect(events[0].place).toBe("Bandodkar Ground, Campal, Panaji");
    expect(events[0].notes).toContain("Next: Ask for a stall");
    expect(events.every((e) => validateEvent(e))).toBe(true);
  });
  it("explains a sheet it can't use", () => {
    expect(eventsFromCsv("Name,Where\nx,y").problems[0]).toMatch(/date column/);
    expect(eventsFromCsv("Date,Event").problems[0]).toMatch(/no rows/);
  });
});

describe("ics export", () => {
  const ev: CalEvent[] = [
    { id: "1", date: "2026-11-22", title: "Mapusa, stall; Sunday", kind: "stall", place: "Mapusa", notes: "line 1\nline 2" },
    { id: "2", date: "2026-11-29", time: "23:30", title: "Late", kind: "other" },
  ];
  const ics = toIcs(ev, new Date("2026-11-11T10:00:00Z"));
  it("writes all-day and timed events with escaped text", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20261122\r\nDTEND;VALUE=DATE:20261123");
    expect(ics).toContain(String.raw`SUMMARY:Mapusa\, stall\; Sunday`);
    expect(ics).toContain("DESCRIPTION:line 1\\nline 2");
    expect(ics).toContain("DTSTART:20261129T233000\r\nDTEND:20261129T235900");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("folds long lines", () => {
    const long = toIcs([{ id: "3", date: "2026-11-22", title: "x".repeat(200), kind: "other" }]);
    expect(long.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});

describe("calendar file", () => {
  let dir: string;
  let store: typeof import("@/lib/calendar-store");
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "hos-cal-"));
    process.env.CALENDAR_FILE = join(dir, "sub", "calendar.json");
    store = await import("@/lib/calendar-store");
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CALENDAR_FILE;
  });

  it("starts empty, adds, edits and deletes", async () => {
    expect(await store.listEvents()).toEqual([]);
    const a = await store.addEvent({ date: "2026-11-22", title: "Mapusa", kind: "stall" });
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.updateEvent(a.id, { date: "2026-11-29", title: "Mapusa (moved)", kind: "stall" })).toMatchObject({ date: "2026-11-29" });
    expect(await store.updateEvent("nope", { date: "2026-11-29", title: "x", kind: "stall" })).toBeNull();
    expect((await store.listEvents()).map((e) => e.title)).toEqual(["Mapusa (moved)"]);
    expect(await store.deleteEvent(a.id)).toBe(true);
    expect(await store.deleteEvent(a.id)).toBe(false);
  });

  it("does not double events when the same sheet is imported twice", async () => {
    const { events } = eventsFromCsv(SHEET);
    expect(await store.importEvents(events)).toEqual({ added: 4, already: 0 });
    expect(await store.importEvents(events)).toEqual({ added: 0, already: 4 });
    expect(await store.listEvents()).toHaveLength(4);
  });

  it("keeps every save when many happen at once", async () => {
    const before = (await store.listEvents()).length;
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.addEvent({ date: "2027-01-03", title: `n${i}`, kind: "other" })));
    expect(await store.listEvents()).toHaveLength(before + 20);
  });

  it("skips hand-edited junk instead of failing", async () => {
    const file = process.env.CALENDAR_FILE!;
    const saved = JSON.parse(readFileSync(file, "utf8")) as { events: unknown[] };
    writeFileSync(file, JSON.stringify({ version: 1, events: [...saved.events, { id: "bad", date: "soon" }, "junk"] }));
    expect(await store.listEvents()).toHaveLength(saved.events.length);
  });
});
