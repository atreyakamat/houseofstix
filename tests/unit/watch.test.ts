import { afterEach, describe, expect, it, vi } from "vitest";
import type { Probe } from "@/lib/probe";
import type { Service } from "@/lib/services";
import { alertRequest, createWatcher, sendAlert, type Change } from "@/lib/watch";

const svc = (id: string, tier: Service["tier"] = "base"): Service => ({
  id,
  name: id.toUpperCase(),
  description: "",
  icon: "",
  group: "",
  tier,
  url: "http://x",
  health: "http://x/health",
  embed: true,
});

/** A watcher whose tools answer from a script: states[id] is consumed one per tick. */
function scripted(states: Record<string, Probe["state"][]>) {
  let minute = 0;
  const w = createWatcher({
    probe: async (s) => ({ state: states[s.id].shift() ?? "up" }),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, minute++)),
  });
  return w;
}

describe("down/up alerts", () => {
  it("alerts once when a tool is confirmed down, and once when it is back", async () => {
    const w = scripted({ a: ["up", "down", "down", "down", "up", "up"] });
    const all: Change[][] = [];
    for (let i = 0; i < 6; i++) all.push(await w.tick([svc("a")]));
    expect(all.map((c) => c.map((x) => x.state))).toEqual([[], [], ["down"], [], ["up"], []]);
    expect(all[4][0].detail).toMatch(/back after \d+ min/);
  });

  it("ignores a single failed check", async () => {
    const w = scripted({ a: ["up", "down", "up", "down", "up"] });
    for (let i = 0; i < 5; i++) expect(await w.tick([svc("a")])).toEqual([]);
  });

  it("alerts for a base tool that never came up", async () => {
    const w = scripted({ a: ["down", "down"] });
    await w.tick([svc("a")]);
    expect((await w.tick([svc("a")])).map((c) => c.state)).toEqual(["down"]);
  });

  it("stays quiet about a heavy tool that is simply switched off", async () => {
    const w = scripted({ h: ["down", "down", "down"] });
    for (let i = 0; i < 3; i++) expect(await w.tick([svc("h", "heavy")])).toEqual([]);
  });

  it("does alert when a heavy tool that was running goes down", async () => {
    const w = scripted({ h: ["up", "down", "down"] });
    await w.tick([svc("h", "heavy")]);
    await w.tick([svc("h", "heavy")]);
    expect((await w.tick([svc("h", "heavy")])).map((c) => c.state)).toEqual(["down"]);
  });

  it("skips tools without a health address", async () => {
    const w = createWatcher({ probe: async () => ({ state: "down" }) });
    const noHealth = { ...svc("p"), health: undefined };
    await w.tick([noHealth]);
    expect(await w.tick([noHealth])).toEqual([]);
  });
});

describe("alert messages", () => {
  const change: Change = { id: "a", name: "Cricut", state: "down", at: "2026-01-01T00:00:00Z", detail: "health answered 502" };
  afterEach(() => vi.unstubAllEnvs());

  it("sends plain text to ntfy", () => {
    const { init } = alertRequest("https://ntfy.sh/my-topic", change);
    expect(init.body).toBe("🔴 Cricut is down (health answered 502)");
    expect((init.headers as Record<string, string>).Priority).toBe("high");
  });

  it("sends JSON with text and content to other webhooks (n8n, Discord, Slack)", () => {
    const { init } = alertRequest("https://n8n.lab/webhook/abc", { ...change, state: "up", detail: "back after 3 min" });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ text: "🟢 Cricut is up again (back after 3 min)", content: body.text, source: "house-of-stix", id: "a" });
  });

  it("ALERT_FORMAT=ntfy forces ntfy for a self-hosted server", () => {
    vi.stubEnv("ALERT_FORMAT", "ntfy");
    expect(alertRequest("http://192.168.1.5:8090/stix", change).init.body).toBe("🔴 Cricut is down (health answered 502)");
  });

  it("never throws when the webhook is unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendAlert("https://n8n.lab/x", change, (async () => { throw new Error("offline"); }) as typeof fetch)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
