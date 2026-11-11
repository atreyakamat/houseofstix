import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkContract, overridePorts, parseReserved, parseStack } from "@/lib/contract";
import { parseServices } from "@/lib/services";

const shipped = () => ({
  services: parseServices(readFileSync("services.yaml", "utf8"), {}),
  stack: parseStack(readFileSync("deploy/stack.conf", "utf8")),
  overrides: Object.fromEntries(
    readdirSync("deploy/overrides")
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [f, readFileSync(`deploy/overrides/${f}`, "utf8")]),
  ),
  reserved: parseReserved(readFileSync("deploy/reserved-ports.conf", "utf8")),
});

describe("the shipped home-lab files agree with each other", () => {
  it("stack.conf is well formed", () => {
    expect(shipped().stack.problems).toEqual([]);
  });

  it("services.yaml, stack.conf, overrides and reserved ports match", () => {
    const s = shipped();
    expect(checkContract({ services: s.services, stack: s.stack.entries, overrides: s.overrides, reserved: s.reserved })).toEqual([]);
  });
});

describe("the contract check catches mistakes", () => {
  const card = (id: string, port: number, extra = "") =>
    `- id: ${id}\n  name: ${id}\n  tier: base\n  url: http://\${HOME_LAB_HOST:-localhost}:${port}\n  health: http://\${HEALTH_HOST:-localhost}:${port}/health\n${extra}`;
  const stackLine = (id: string, repo = "https://github.com/a/b", compose = "docker-compose.yml") => `${id} base yes ${repo} ${compose}`;
  const run = (cards: string, stack: string, overrides: Record<string, string> = {}, reserved = "3000 - AdGuard Home") =>
    checkContract({
      services: parseServices(cards, {}),
      stack: parseStack(stack).entries,
      overrides,
      reserved: parseReserved(reserved),
    });

  it("two tools on one port", () => {
    expect(run(card("a", 8300) + card("b", 8300), `${stackLine("a")}\n${stackLine("b")}`)).toContain('port 8300 is used by both "a" and "b"');
  });

  it("a tool on a port another program owns", () => {
    expect(run(card("a", 3000), stackLine("a")).join()).toMatch(/port 3000, which belongs to AdGuard Home/);
  });

  it("a tool stixctl runs but the control room doesn't show", () => {
    expect(run("[]", stackLine("a")).join()).toMatch(/"a" has no card/);
  });

  it("a tool with no health address", () => {
    const noHealth = `- id: a\n  name: a\n  tier: base\n  url: http://localhost:8300\n`;
    expect(run(noHealth, stackLine("a")).join()).toMatch(/no health address/);
  });

  it("an override that publishes a port the card doesn't use", () => {
    const o = { "a.yml": 'services:\n  web:\n    ports: !override\n      - "8399:80"\n' };
    expect(run(card("a", 8300), stackLine("a"), o).join()).toMatch(/publishes port 8399/);
  });

  it("allows a helper port bound to this machine only", () => {
    const o = { "a.yml": 'services:\n  web:\n    ports: !override\n      - "8300:80"\n  api:\n    ports: !override\n      - "127.0.0.1:8000:8000"\n' };
    expect(run(card("a", 8300), stackLine("a"), o)).toEqual([]);
  });

  it("an override for a tool that isn't in stack.conf", () => {
    expect(run(card("a", 8300), stackLine("a"), { "zz.yml": '      - "1:1"\n' }).join()).toMatch(/no tool "zz"/);
  });

  it("a bad stack.conf line", () => {
    expect(parseStack("a base maybe ftp://x docker-compose.yml").problems.join()).toMatch(/enabled must be yes or no/);
    expect(parseStack("a base yes https://github.com/a/b").problems.join()).toMatch(/5 columns/);
    expect(parseStack("a base yes external:x docker-compose.yml").problems.join()).toMatch(/compose is "-"/);
  });

  it("reads published ports in every Compose spelling", () => {
    expect(overridePorts('      - "8301:80"\n      - 127.0.0.1:8000:8000\n      - \'9:9/tcp\'\n')).toEqual([
      { port: 8301, localOnly: false },
      { port: 8000, localOnly: true },
      { port: 9, localOnly: false },
    ]);
  });
});
