"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { localDay, upcoming, type CalEvent } from "@/lib/calendar";
import type { Probe } from "@/lib/probe";
import type { PublicService, Tier } from "@/lib/services";
import { AppWindow, type WinState } from "./app-window";
import { CalendarApp } from "./calendar-app";

const TIER_LABEL: Record<Tier, string> = { base: "Always on", core: "Business", heavy: "On demand", cloud: "Hosted" };
const POLL_MS = 15_000;
const LAYOUT_KEY = "hos.layout.v1";
const MIN_W = 360;
const MIN_H = 240;

type Statuses = Record<string, Probe>;

/** Apps the control room draws itself, not tools in services.yaml. Ids can't clash: services.yaml ids have no "hos-" tools. */
const CALENDAR: PublicService = {
  id: "hos-calendar",
  name: "Calendar",
  description: "Stall days, college events and coupon end dates.",
  icon: "📅",
  group: "Built in",
  tier: "base",
  url: "",
  embed: true,
  checked: false,
};
type Layout = Record<string, Pick<WinState, "x" | "y" | "w" | "h">>;

const phoneQuery = "(max-width: 767px)";
function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(phoneQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(phoneQuery).matches,
    () => false,
  );
}

function readLayout(): Layout {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as Layout;
  } catch {
    return {};
  }
}

/** The status as words and a dot, so colour is never the only signal. */
const LIGHT: Record<string, { dot: string; text: string }> = {
  up: { dot: "bg-up", text: "Up" },
  down: { dot: "bg-down", text: "Down" },
  loading: { dot: "bg-mute/50", text: "Checking…" },
  off: { dot: "bg-mute/50", text: "Off" },
  unchecked: { dot: "bg-mute/50", text: "Not checked" },
};

function lightState(probe: Probe | undefined, checked: boolean) {
  if (!checked) return "unchecked";
  return probe ? probe.state : "loading";
}

function Light({ probe, checked }: { probe?: Probe; checked: boolean }) {
  const state = lightState(probe, checked);
  const { dot } = LIGHT[state];
  const ms = state === "up" && probe?.ms !== undefined ? " · " + probe.ms + " ms" : "";
  const text = LIGHT[state].text + ms;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-mute">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </span>
  );
}

export function Desktop({ services }: { services: PublicService[] }) {
  const phone = usePhone();
  const area = useRef<HTMLDivElement>(null);
  const zTop = useRef(10);
  const [wins, setWins] = useState<Record<string, WinState>>({});
  const [statuses, setStatuses] = useState<Statuses>({});
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [calError, setCalError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar", { cache: "no-store" });
      if (res.status === 401) return window.location.reload();
      const data = (await res.json()) as { events?: CalEvent[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't load the calendar");
      setEvents(data.events ?? []);
      setCalError(null);
    } catch (e) {
      setCalError(e instanceof Error ? e.message : "Couldn't load the calendar");
    }
  }, []);

  useEffect(() => {
    // Loads once on open; state is only set after the fetch answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEvents();
  }, [loadEvents]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.status === 401) return window.location.reload();
      if (res.ok) {
        const data = (await res.json()) as { checkedAt: string; services: Statuses };
        setStatuses(data.services);
        setCheckedAt(data.checkedAt);
      }
    } catch {
      /* offline: keep the last answer */
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Check now, then every 15 s while the tab is showing.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      void refresh();
      timer = setInterval(() => void refresh(), POLL_MS);
    };
    const onVis = () => {
      clearInterval(timer);
      if (document.visibilityState === "visible") start();
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const bounds = () => ({ w: area.current?.clientWidth ?? 1200, h: area.current?.clientHeight ?? 700 });

  const open = (s: PublicService) => {
    // Sites that forbid embedding open in their own tab.
    if (!s.embed) return void window.open(s.url, "_blank", "noopener,noreferrer");
    setWins((all) => {
      const z = ++zTop.current;
      const existing = all[s.id];
      if (existing) return { ...all, [s.id]: { ...existing, z, min: false } };
      const b = bounds();
      const saved = readLayout()[s.id];
      const n = Object.keys(all).length;
      const w = Math.min(saved?.w ?? 960, b.w - 24);
      const h = Math.min(saved?.h ?? 620, b.h - 24);
      const x = saved?.x ?? Math.max(12, Math.min(40 + n * 32, b.w - w - 12));
      const y = saved?.y ?? Math.max(12, Math.min(24 + n * 32, b.h - h - 12));
      return { ...all, [s.id]: { x, y, w, h, z, min: false, max: false } };
    });
  };

  const patch = (id: string, p: Partial<WinState>) => setWins((all) => (all[id] ? { ...all, [id]: { ...all[id], ...p } } : all));
  const focus = (id: string) => setWins((all) => (all[id] && all[id].z !== zTop.current ? { ...all, [id]: { ...all[id], z: ++zTop.current } } : all));
  const remember = (id: string, w: WinState) => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...readLayout(), [id]: { x: w.x, y: w.y, w: w.w, h: w.h } }));
    } catch {
      /* private mode: layout just isn't remembered */
    }
  };
  const close = (id: string) => setWins((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== id)));

  const moveTo = (id: string, x: number, y: number) => {
    const b = bounds();
    const w = wins[id];
    if (!w) return;
    patch(id, { x: Math.max(-w.w + 120, Math.min(x, b.w - 120)), y: Math.max(0, Math.min(y, b.h - 40)) });
  };
  const sizeTo = (id: string, w: number, h: number) => patch(id, { w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) });
  const endInteract = (id: string, on: boolean) => {
    setInteracting(on);
    if (!on && wins[id]) remember(id, wins[id]);
  };

  const signOut = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.reload();
  };

  const checked = services.filter((s) => s.checked && statuses[s.id]?.state !== "off");
  const upCount = checked.filter((s) => statuses[s.id]?.state === "up").length;
  const downNames = checked.filter((s) => statuses[s.id]?.state === "down").map((s) => s.name);
  const groups = [...new Set(services.map((s) => s.group))];
  const allApps = [CALENDAR, ...services];
  const openList = allApps.filter((s) => wins[s.id]);
  const nextUp = upcoming(events ?? [], localDay(), 1)[0];
  const topId = openList.filter((s) => !wins[s.id].min).sort((a, b) => wins[b.id].z - wins[a.id].z)[0]?.id;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <h1 className="display text-xl">House of Stix</h1>
        <p className="ml-2 flex-1 truncate text-sm text-mute" aria-live="polite">
          {!checkedAt ? (
            "Checking…"
          ) : downNames.length ? (
            <span className="text-down">
              {downNames.length} down<span className="hidden sm:inline">: {downNames.join(", ")}</span>
            </span>
          ) : (
            `All ${checked.length} checked tools are up`
          )}
          {checkedAt && downNames.length > 0 && (
            <span className="hidden text-mute sm:inline">
              {" "}
              · {upCount} of {checked.length} up
            </span>
          )}
        </p>
        <button type="button" className="rounded-md px-2 py-1 text-sm text-mute hover:text-lemon disabled:opacity-50" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? "Checking…" : "Check now"}
        </button>
        <button type="button" className="rounded-md px-2 py-1 text-sm text-mute hover:text-lemon" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <div ref={area} className="desk relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 overflow-auto p-4 sm:p-6">
          <section className="mb-8" aria-label="Built in">
            <h2 className="mb-3 text-xs uppercase tracking-[0.16em] text-mute">Built in</h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-3">
              <li>
                <motion.button
                  type="button"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => open(CALENDAR)}
                  className={`flex h-full w-full flex-col items-start gap-2 rounded-2xl border bg-surface p-4 text-left hover:border-lemon/60 ${wins[CALENDAR.id] ? "border-lemon/70" : "border-line"}`}
                >
                  <span className="text-3xl" aria-hidden="true">
                    {CALENDAR.icon}
                  </span>
                  <span className="font-medium">{CALENDAR.name}</span>
                  <span className="text-xs text-mute">{CALENDAR.description}</span>
                  <span className="mt-auto pt-1 text-xs text-mute">
                    {calError ? (
                      <span className="text-down">Calendar unavailable</span>
                    ) : events === null ? (
                      "Loading…"
                    ) : nextUp ? (
                      <>
                        Next: <span className="text-paper">{nextUp.title}</span>,{" "}
                        {new Date(`${nextUp.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                      </>
                    ) : (
                      "Nothing coming up"
                    )}
                  </span>
                </motion.button>
              </li>
            </ul>
          </section>

          {groups.map((g) => (
            <section key={g} className="mb-8" aria-label={g}>
              <h2 className="mb-3 text-xs uppercase tracking-[0.16em] text-mute">{g}</h2>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-3">
                {services
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <li key={s.id}>
                      <motion.button
                        type="button"
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => open(s)}
                        className={`flex h-full w-full flex-col items-start gap-2 rounded-2xl border bg-surface p-4 text-left hover:border-lemon/60 ${wins[s.id] ? "border-lemon/70" : "border-line"}`}
                      >
                        <span className="flex w-full items-start justify-between">
                          <span className="text-3xl" aria-hidden="true">
                            {s.icon}
                          </span>
                          <span className="text-[0.68rem] uppercase tracking-wider text-mute">{TIER_LABEL[s.tier]}</span>
                        </span>
                        <span className="font-medium">
                          {s.name}
                          {!s.embed && <span className="text-mute"> ↗</span>}
                        </span>
                        <span className="text-xs text-mute">{s.description}</span>
                        <span className="mt-auto pt-1">
                          <Light probe={statuses[s.id]} checked={s.checked} />
                        </span>
                      </motion.button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>

        <AnimatePresence>
          {openList.map((s) => (
            <AppWindow
              key={s.id}
              service={s}
              win={wins[s.id]}
              mobile={phone}
              interacting={interacting}
              onFocus={() => focus(s.id)}
              onClose={() => close(s.id)}
              onMin={() => patch(s.id, { min: true })}
              onMax={() => patch(s.id, { max: !wins[s.id].max })}
              onMove={(x, y) => moveTo(s.id, x, y)}
              onResize={(w, h) => sizeTo(s.id, w, h)}
              onInteract={(on) => endInteract(s.id, on)}
            >
              {s.id === CALENDAR.id ? <CalendarApp events={events} error={calError} onChanged={loadEvents} /> : undefined}
            </AppWindow>
          ))}
        </AnimatePresence>
      </div>

      <nav className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-t border-line px-3" aria-label="Open windows">
        {openList.length === 0 && <span className="text-sm text-mute">Open a tool to start.</span>}
        {openList.map((s) => {
          const w = wins[s.id];
          const active = !w.min && s.id === topId;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={active}
              onClick={() => (active ? patch(s.id, { min: true }) : patch(s.id, { min: false, z: ++zTop.current }))}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${active ? "bg-lemon text-ink" : "bg-surface-2 text-paper hover:bg-paper/10"} ${w.min ? "opacity-60" : ""}`}
            >
              <span aria-hidden="true">{s.icon}</span>
              {s.name}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
