"use client";

import { useId, useMemo, useRef, useState } from "react";
import { KIND_LABEL, KINDS, localDay, monthGrid, sortEvents, upcoming, type CalEvent, type EventInput, type Kind } from "@/lib/calendar";

const KIND_STYLE: Record<Kind, string> = {
  stall: "bg-lemon text-ink",
  college: "bg-sky-300 text-ink",
  coupon: "bg-down text-ink",
  other: "bg-paper/80 text-ink",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const field = "w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-paper placeholder:text-mute/70";

const dayTone = (isToday: boolean, inMonth: boolean) => {
  if (isToday) return "font-semibold text-lemon";
  return inMonth ? "text-paper" : "text-mute/60";
};
const monthName = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const nice = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

type Draft = EventInput & { id?: string };
const blank = (date: string): Draft => ({ date, title: "", kind: "stall" });

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) window.location.reload();
  const data = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) throw new Error(data.error ?? `The control room said ${res.status}`);
  return data;
}

type Props = Readonly<{ events: CalEvent[] | null; error: string | null; onChanged: () => Promise<void> | void }>;

export function CalendarApp({ events, error, onChanged }: Props) {
  const today = localDay();
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formId = useId();

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of sortEvents(events ?? [])) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [events]);
  const next = useMemo(() => upcoming(events ?? [], today, 8), [events, today]);
  const cells = monthGrid(ym.y, ym.m);

  const shift = (by: number) => setYm(({ y, m }) => ({ y: y + Math.floor((m - 1 + by) / 12), m: ((((m - 1 + by) % 12) + 12) % 12) + 1 }));
  const goToday = () => setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote({ ok: true, text: await work() });
      await onChanged();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "That didn't work" });
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const { id, ...event } = draft;
    void run(async () => {
      await send(id ? `/api/calendar/${encodeURIComponent(id)}` : "/api/calendar", id ? "PUT" : "POST", { event });
      setDraft(null);
      return id ? "Saved." : `Added to ${nice(event.date)}.`;
    });
  };

  const remove = () => {
    if (!draft?.id || !window.confirm(`Delete "${draft.title}" on ${nice(draft.date)}?`)) return;
    const id = draft.id;
    void run(async () => {
      await send(`/api/calendar/${encodeURIComponent(id)}`, "DELETE");
      setDraft(null);
      return "Deleted.";
    });
  };

  const importCsv = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const data = (await send("/api/calendar", "POST", { csv: await file.text() })) as { added: number; already: number; skipped: number; problems: string[] };
      const parts = [`${data.added} added`];
      if (data.already) parts.push(`${data.already} already there`);
      if (data.skipped) parts.push(`${data.skipped} left out (marked Skip or no date)`);
      return `Imported ${file.name}: ${parts.join(", ")}.`;
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink text-paper">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" className="rounded-md px-2 py-1 text-sm hover:bg-paper/10" onClick={() => shift(-1)} aria-label="Previous month">
          ‹
        </button>
        <h3 className="min-w-36 text-center text-sm font-medium" aria-live="polite">
          {monthName(ym.y, ym.m)}
        </h3>
        <button type="button" className="rounded-md px-2 py-1 text-sm hover:bg-paper/10" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
        <button type="button" className="rounded-md px-2 py-1 text-sm text-mute hover:text-lemon" onClick={goToday}>
          Today
        </button>
        <span className="flex-1" />
        <button type="button" className="rounded-md bg-lemon px-3 py-1 text-sm font-medium text-ink" onClick={() => setDraft(blank(today))}>
          + Add
        </button>
        <button type="button" className="rounded-md px-2 py-1 text-sm text-mute hover:text-lemon disabled:opacity-50" disabled={busy} onClick={() => fileRef.current?.click()} title="Import a pop-up sheet saved as CSV">
          Import CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />
        <a className="rounded-md px-2 py-1 text-sm text-mute hover:text-lemon" href="/api/calendar/ics" download title="Download every event as a .ics file for your phone or Google Calendar">
          Export .ics
        </a>
      </div>

      {(note || error) && (
        <output className={`block border-b border-line px-3 py-1.5 text-sm ${note?.ok && !error ? "text-up" : "text-down"}`}>
          {error ?? note?.text}
        </output>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Month grid: hidden on phones, where the list below is easier to use. */}
        <div className="hidden min-h-0 flex-1 flex-col p-2 md:flex">
          <div className="grid grid-cols-7 text-center text-[0.68rem] uppercase tracking-wider text-mute">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
            {cells.map(({ day, inMonth }) => {
              const list = byDay.get(day) ?? [];
              const isToday = day === today;
              return (
                <div key={day} className={`group relative flex min-h-0 flex-col gap-0.5 overflow-hidden p-1 ${inMonth ? "bg-surface" : "bg-surface/40"}`}>
                  <button
                    type="button"
                    className={`absolute inset-0 ${isToday ? "ring-1 ring-inset ring-lemon" : ""}`}
                    aria-label={`Add an event on ${nice(day)}`}
                    onClick={() => setDraft(blank(day))}
                  />
                  <span className={`pointer-events-none relative text-xs ${dayTone(isToday, inMonth)}`}>{Number(day.slice(8))}</span>
                  {list.slice(0, 3).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setDraft({ ...e })}
                      title={`${KIND_LABEL[e.kind]}: ${e.title}${e.place ? " · " + e.place : ""}`}
                      className={`relative truncate rounded px-1 text-left text-[0.7rem] leading-4 ${KIND_STYLE[e.kind]}`}
                    >
                      {e.time ? `${e.time} ` : ""}
                      {e.title}
                    </button>
                  ))}
                  {list.length > 3 && <span className="pointer-events-none relative text-[0.68rem] text-mute">+{list.length - 3} more</span>}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="flex min-h-0 flex-col border-line md:w-72 md:border-l" aria-label="Coming up">
          <h3 className="px-3 pt-3 text-xs uppercase tracking-[0.16em] text-mute">Coming up</h3>
          {events === null && !error && <p className="px-3 py-2 text-sm text-mute">Loading…</p>}
          {events !== null && next.length === 0 && (
            <p className="px-3 py-2 text-sm text-mute">Nothing coming up. Add a stall day, or import your pop-up sheet (CSV).</p>
          )}
          <ul className="min-h-0 flex-1 overflow-auto p-2">
            {next.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setDraft({ ...e })} className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-paper/5">
                  <span className="flex items-center gap-2 text-xs text-mute">
                    <span className={`rounded px-1.5 text-[0.65rem] ${KIND_STYLE[e.kind]}`}>{KIND_LABEL[e.kind]}</span>
                    {e.date === today ? "Today" : nice(e.date)}
                    {e.time ? ` · ${e.time}` : ""}
                  </span>
                  <span className="text-sm">{e.title}</span>
                  {e.place && <span className="text-xs text-mute">{e.place}</span>}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {draft && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/60 p-3">
          <form
            id={formId}
            onSubmit={save}
            onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
            className="max-h-full w-full max-w-md space-y-3 overflow-auto rounded-xl border border-line bg-surface p-4 shadow-2xl"
            aria-label={draft.id ? "Edit event" : "New event"}
          >
            <h3 className="font-medium">{draft.id ? "Edit event" : "New event"}</h3>
            <label className="block space-y-1 text-xs text-mute">
              <span>What</span>
              <input className={field} required maxLength={120} value={draft.title} placeholder="Sunday stall at Mapusa market" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1 text-xs text-mute">
                <span>Day</span>
                <input className={field} type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </label>
              <label className="block space-y-1 text-xs text-mute">
                <span>Time (optional)</span>
                <input className={field} type="time" value={draft.time ?? ""} onChange={(e) => setDraft({ ...draft, time: e.target.value || undefined })} />
              </label>
            </div>
            <label className="block space-y-1 text-xs text-mute">
              <span>Kind</span>
              <select className={field} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs text-mute">
              <span>Where (optional)</span>
              <input className={field} maxLength={160} value={draft.place ?? ""} onChange={(e) => setDraft({ ...draft, place: e.target.value || undefined })} />
            </label>
            <label className="block space-y-1 text-xs text-mute">
              <span>Notes (optional)</span>
              <textarea className={`${field} min-h-20`} maxLength={1000} value={draft.notes ?? ""} placeholder="Stall fee, contact, what to bring" onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })} />
            </label>
            <div className="flex items-center gap-2 pt-1">
              {draft.id && (
                <button type="button" className="rounded-md px-3 py-1.5 text-sm text-down hover:bg-down/10 disabled:opacity-50" disabled={busy} onClick={remove}>
                  Delete
                </button>
              )}
              <span className="flex-1" />
              <button type="button" className="rounded-md px-3 py-1.5 text-sm text-mute hover:text-paper" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="rounded-md bg-lemon px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-50" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
