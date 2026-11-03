import { describe, expect, it, vi } from "vitest";
import { authConfig, makeLimiter, passwordMatches, SESSION_SECONDS, signSession, verifySession } from "@/lib/auth";
import { probe } from "@/lib/probe";
import { interpolate, parseServices, toPublic } from "@/lib/services";

const SECRET = "s".repeat(40);

describe("services.yaml", () => {
  const ok = `
- id: cricut
  name: Cricut
  tier: base
  url: http://\${HOST:-localhost}:8300
  health: http://localhost:8300/health
  expect: '"ok":true'
`;

  it("fills \${NAME} and \${NAME:-default} from the environment", () => {
    expect(interpolate("http://${HOST:-localhost}:1", {})).toBe("http://localhost:1");
    expect(interpolate("http://${HOST:-localhost}:1", { HOST: "lab" })).toBe("http://lab:1");
    expect(interpolate("a${NOPE}b", {})).toBe("ab");
  });

  it("parses a tool and applies defaults", () => {
    const [s] = parseServices(ok, { HOST: "lab" });
    expect(s).toMatchObject({ id: "cricut", url: "http://lab:8300", embed: true, group: "Tools", expect: '"ok":true' });
  });

  it("keeps health addresses out of what the browser receives", () => {
    const pub = toPublic(parseServices(ok, {})[0]);
    expect(pub).not.toHaveProperty("health");
    expect(pub).not.toHaveProperty("expect");
    expect(pub.checked).toBe(true);
  });

  it("rejects bad entries with a message that names the tool", () => {
    expect(() => parseServices("- {id: A, name: x, tier: base, url: http://a}", {})).toThrow(/lowercase/);
    expect(() => parseServices("- {id: a, name: x, tier: nope, url: http://a}", {})).toThrow(/tier/);
    expect(() => parseServices("- {id: a, name: x, tier: base, url: ftp://a}", {})).toThrow(/http/);
    expect(() => parseServices("- {id: a, name: x, tier: base, url: http://a, embed: 'no'}", {})).toThrow(/embed/);
    expect(() => parseServices("- {id: a, name: x, tier: base, url: http://a}\n- {id: a, name: y, tier: base, url: http://b}", {})).toThrow(/twice/);
    expect(() => parseServices("not: a list", {})).toThrow(/list/);
  });

  it("loads the shipped services.yaml", async () => {
    const { readFileSync } = await import("node:fs");
    const list = parseServices(readFileSync("services.yaml", "utf8"), {});
    expect(list.map((s) => s.id)).toEqual(["shop", "admin", "landing", "inwoice", "receipts", "cricut", "bgremover", "scaleup", "renamex", "portainer"]);
  });
});

describe("login", () => {
  it("stays closed unless a password and a long secret are set", () => {
    expect(authConfig({})).toBeNull();
    expect(authConfig({ HOUSE_PASSWORD: "longenough", HOUSE_SECRET: "short" })).toBeNull();
    expect(authConfig({ HOUSE_PASSWORD: "short", HOUSE_SECRET: SECRET })).toBeNull();
    expect(authConfig({ HOUSE_PASSWORD: "longenough", HOUSE_SECRET: SECRET })).toEqual({ password: "longenough", secret: SECRET });
  });

  it("checks the password", () => {
    expect(passwordMatches("hunter2hunter2", "hunter2hunter2")).toBe(true);
    expect(passwordMatches("hunter2", "hunter2hunter2")).toBe(false);
  });

  it("accepts its own cookie, rejects tampering, other secrets and expiry", () => {
    const now = 1_800_000_000_000;
    const t = signSession(SECRET, now);
    expect(verifySession(t, SECRET, now + 1000)).toBe(true);
    expect(verifySession(t, "x".repeat(40), now + 1000)).toBe(false);
    const [exp, sig] = t.split(".");
    expect(verifySession(`${Number(exp) + 999999}.${sig}`, SECRET, now)).toBe(false);
    expect(verifySession(t, SECRET, now + (SESSION_SECONDS + 1) * 1000)).toBe(false);
    expect(verifySession(undefined, SECRET)).toBe(false);
    expect(verifySession("garbage", SECRET)).toBe(false);
    expect(verifySession(`${exp}.${sig}.extra`, SECRET, now)).toBe(false);
  });

  it("allows 5 tries a minute per visitor", () => {
    const allow = makeLimiter(5, 60_000);
    for (let i = 0; i < 5; i++) expect(allow("1.2.3.4", 1000 + i)).toBe(true);
    expect(allow("1.2.3.4", 2000)).toBe(false);
    expect(allow("5.6.7.8", 2000)).toBe(true);
    expect(allow("1.2.3.4", 62_000)).toBe(true);
  });
});

describe("health probe", () => {
  const reply = (status: number, body = "") => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

  it("is unchecked without a health address", async () => {
    expect(await probe({})).toEqual({ state: "unchecked" });
  });
  it("is up on a good reply, down on an error status", async () => {
    expect((await probe({ health: "http://x" }, { fetchImpl: reply(200) })).state).toBe("up");
    expect(await probe({ health: "http://x" }, { fetchImpl: reply(503) })).toMatchObject({ state: "down", code: 503 });
  });
  it("is down when the expected text is missing", async () => {
    expect((await probe({ health: "http://x", expect: '"ok":true' }, { fetchImpl: reply(200, '{"ok":false}') })).state).toBe("down");
    expect((await probe({ health: "http://x", expect: '"ok":true' }, { fetchImpl: reply(200, '{"ok":true}') })).state).toBe("up");
  });
  it("is down when the tool can't be reached or is too slow", async () => {
    const refused = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await probe({ health: "http://x" }, { fetchImpl: refused })).toEqual({ state: "down" });
    const hang = vi.fn((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
    expect((await probe({ health: "http://x" }, { fetchImpl: hang, timeoutMs: 20 })).state).toBe("down");
  });
});
