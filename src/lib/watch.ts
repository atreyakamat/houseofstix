import { probe as realProbe, type Probe } from "./probe";
import type { Service } from "./services";

/**
 * Watches every tool in the background and tells you when one goes down or
 * comes back, even when nobody has the control room open.
 *
 * A tool counts as down only after `confirm` failed checks in a row, so a
 * single slow reply or a restart doesn't wake you up. Heavy tools (started by
 * hand) only alert after they were seen up. ALERT_IGNORE=id,id silences tools. Messages go to
 * ALERT_WEBHOOK_URL: an ntfy topic (https://ntfy.sh/<topic> or your own ntfy),
 * or any webhook that takes JSON (n8n, Discord, Slack, Mattermost).
 */

export type Change = { id: string; name: string; state: "down" | "up"; at: string; detail: string };
type Track = { state: "up" | "down" | "unknown"; fails: number; since: string };

export function createWatcher(opts: {
  confirm?: number;
  probe?: (s: Service) => Promise<Probe>;
  now?: () => Date;
}) {
  const confirm = opts.confirm ?? 2;
  const probe = opts.probe ?? ((s: Service) => realProbe(s));
  const now = opts.now ?? (() => new Date());
  const tracks = new Map<string, Track>();

  /** One round of checks. Returns the changes worth telling someone about. */
  async function tick(services: Service[]): Promise<Change[]> {
    const changes: Change[] = [];
    const checked = services.filter((s) => s.health);
    const results = await Promise.all(checked.map(async (s) => [s, await probe(s)] as const));
    const at = now().toISOString();
    for (const [s, r] of results) {
      const t = tracks.get(s.id) ?? { state: "unknown", fails: 0, since: at };
      const change = step(s, r, t, at, confirm);
      if (change) changes.push(change);
      tracks.set(s.id, t);
    }
    // Forget tools that were removed from services.yaml.
    for (const id of tracks.keys()) if (!checked.some((s) => s.id === id)) tracks.delete(id);
    return changes;
  }

  return { tick, snapshot: () => Object.fromEntries(tracks) };
}

/** Moves one tool's track on by one check result; returns a change worth telling about, if any. */
function step(s: Service, r: Probe, t: Track, at: string, confirm: number): Change | undefined {
  if (r.state === "up") {
    const back = t.state === "down" ? { id: s.id, name: s.name, state: "up" as const, at, detail: `back after ${minutes(t.since, at)}` } : undefined;
    if (t.state !== "up") t.since = at;
    t.state = "up";
    t.fails = 0;
    return back;
  }
  t.fails += 1;
  // Heavy tools are started by hand when needed, so a heavy tool that was never
  // up since the control room started is just switched off, not broken.
  const off = s.tier === "heavy" && t.state === "unknown";
  if (t.fails < confirm || t.state === "down" || off) return undefined;
  t.state = "down";
  t.since = at;
  return { id: s.id, name: s.name, state: "down", at, detail: r.code ? `health answered ${r.code}` : "no answer from health check" };
}

function minutes(from: string, to: string) {
  const m = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
  return m < 120 ? `${m} min` : `${Math.round(m / 60)} h`;
}

export function alertText(c: Change) {
  return c.state === "down" ? `🔴 ${c.name} is down (${c.detail})` : `🟢 ${c.name} is up again (${c.detail})`;
}

/** Builds the request for one change. ntfy gets plain text; everything else gets JSON. */
export function alertRequest(url: string, c: Change): { url: string; init: RequestInit } {
  const u = new URL(url);
  const text = alertText(c);
  const ntfy = process.env.ALERT_FORMAT === "ntfy" || (process.env.ALERT_FORMAT !== "json" && /(^|\.)ntfy\./.test(u.hostname));
  if (ntfy) {
    return {
      url,
      init: {
        method: "POST",
        body: text,
        headers: { Title: "House of Stix", Tags: c.state === "down" ? "rotating_light" : "white_check_mark", Priority: c.state === "down" ? "high" : "default" },
      },
    };
  }
  // "text" for Slack/Mattermost/n8n, "content" for Discord; the rest is for n8n flows.
  return {
    url,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text, source: "house-of-stix", ...c }),
    },
  };
}

export async function sendAlert(url: string, c: Change, fetchImpl: typeof fetch = fetch) {
  const { init } = alertRequest(url, c);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctl.signal });
    if (!res.ok) console.warn(`[alerts] webhook answered ${res.status}`);
  } catch {
    console.warn("[alerts] could not reach the alert webhook");
  } finally {
    clearTimeout(timer);
  }
}
