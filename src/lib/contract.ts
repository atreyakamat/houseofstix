import { TIERS, type Service } from "./services";
import { STACK_TO_CARD } from "./stack-ids";

export { STACK_TO_CARD };

/**
 * The House of Stix contract, checked in CI so a mismatch between the files
 * that describe the home lab is caught before it is merged, not on the box.
 *
 *   services.yaml          what the control room shows and health-checks
 *   deploy/stack.conf      what stixctl clones, builds and starts
 *   deploy/overrides/*.yml host ports stixctl moves a tool to
 *   deploy/reserved-ports.conf  ports other programs on the box already own
 */

export type StackEntry = { id: string; tier: string; enabled: boolean; repo: string; compose: string; line: number };
export type Reserved = { port: number; owner: string; what: string };

/** stack.conf ids that have no card of their own. */
const NO_CARD = new Set(["hub"]);
const STACK_TIERS = TIERS.filter((t) => t !== "cloud");

const rows = (text: string) =>
  text
    .split("\n")
    .map((raw, i) => ({ cols: raw.replace(/#.*/, "").trim().split(/\s+/).filter(Boolean), line: i + 1 }))
    .filter((r) => r.cols.length > 0);

export function parseStack(text: string): { entries: StackEntry[]; problems: string[] } {
  const problems: string[] = [];
  const entries: StackEntry[] = [];
  const seen = new Set<string>();
  for (const { cols, line } of rows(text)) {
    const where = `stack.conf line ${line}`;
    if (cols.length !== 5) {
      problems.push(`${where}: needs 5 columns (id tier enabled repo compose), found ${cols.length}`);
      continue;
    }
    const [id, tier, enabled, repo, compose] = cols;
    if (seen.has(id)) problems.push(`${where}: id "${id}" is listed twice`);
    seen.add(id);
    if (!(STACK_TIERS as readonly string[]).includes(tier)) problems.push(`${where} (${id}): tier must be ${STACK_TIERS.join(", ")}`);
    if (enabled !== "yes" && enabled !== "no") problems.push(`${where} (${id}): enabled must be yes or no`);
    const external = repo.startsWith("external:");
    if (!(repo === "self" || /^external:[\w.-]+$/.test(repo) || /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo)))
      problems.push(`${where} (${id}): repo must be self, external:<container> or https://github.com/<owner>/<repo>`);
    if (external !== (compose === "-")) problems.push(`${where} (${id}): compose is "-" exactly when repo is external:`);
    entries.push({ id, tier, enabled: enabled === "yes", repo, compose, line });
  }
  return { entries, problems };
}

export function parseReserved(text: string): Reserved[] {
  return rows(text).map(({ cols }) => ({ port: Number(cols[0]), owner: cols[1], what: cols.slice(2).join(" ") }));
}

/** Host ports published by an override file ("8301:80", "127.0.0.1:8000:8000"). */
export function overridePorts(text: string): { port: number; localOnly: boolean }[] {
  const out: { port: number; localOnly: boolean }[] = [];
  for (const m of text.matchAll(/^\s*-\s*["']?(?:([\d.]+):)?(\d+):(\d+)(?:\/\w+)?["']?\s*$/gm)) {
    out.push({ port: Number(m[2]), localOnly: m[1] === "127.0.0.1" });
  }
  return out;
}

/** Is this card served from the home lab (as opposed to the cloud)? */
export const isLocal = (s: Service) => s.tier !== "cloud";

/** Every port a card's url and health use. */
export function cardPorts(s: Service): number[] {
  const ports = new Set<number>();
  for (const u of [s.url, s.health]) {
    if (!u) continue;
    const url = new URL(u);
    ports.add(Number(url.port || (url.protocol === "https:" ? 443 : 80)));
  }
  return [...ports];
}

export function checkContract(input: {
  services: Service[];
  stack: StackEntry[];
  overrides: Record<string, string>;
  reserved: Reserved[];
}): string[] {
  const { services, stack, overrides, reserved } = input;
  const problems: string[] = [];
  const cards = new Map(services.map((s) => [s.id, s]));
  const stackIds = new Set(stack.map((e) => e.id));
  const cardOf = (id: string) => STACK_TO_CARD[id] ?? id;
  const reservedBy = new Map(reserved.map((r) => [r.port, r]));

  // Every tool stixctl runs has a card, and that card is health-checked.
  for (const e of stack) {
    if (NO_CARD.has(e.id)) continue;
    const card = cards.get(cardOf(e.id));
    if (!card) {
      problems.push(`stack.conf "${e.id}" has no card in services.yaml (expected id "${cardOf(e.id)}")`);
      continue;
    }
    if (!card.health) problems.push(`services.yaml "${card.id}": runs on the home lab but has no health address, so nobody would notice it is down`);
  }

  // Every home-lab card is either run by stixctl or owns a reserved port (an existing program).
  const carded = new Set(stack.map((e) => cardOf(e.id)));
  for (const s of services.filter(isLocal)) {
    if (carded.has(s.id)) continue;
    if (!cardPorts(s).some((p) => reservedBy.get(p)?.owner === s.id))
      problems.push(`services.yaml "${s.id}": not in stack.conf and not an existing program in reserved-ports.conf`);
  }

  // No two tools share a host port, and nobody takes a port another program owns.
  const portOwner = new Map<number, string>([[8200, "hub"]]);
  for (const s of services.filter(isLocal)) {
    for (const p of cardPorts(s)) {
      const other = portOwner.get(p);
      if (other && other !== s.id) problems.push(`port ${p} is used by both "${other}" and "${s.id}"`);
      else portOwner.set(p, s.id);
      const r = reservedBy.get(p);
      if (r && r.owner !== s.id) problems.push(`"${s.id}" uses port ${p}, which belongs to ${r.what}`);
    }
  }

  // Override files: one per stack id, and every port they publish to the network is the tool's card port.
  for (const [name, text] of Object.entries(overrides)) {
    const id = name.replace(/\.ya?ml$/, "");
    if (!stackIds.has(id)) {
      problems.push(`overrides/${name}: no tool "${id}" in stack.conf, so stixctl never uses it`);
      continue;
    }
    const card = cards.get(cardOf(id));
    const ports = overridePorts(text);
    if (ports.length === 0) problems.push(`overrides/${name}: publishes no ports (use !override with a list of "host:container")`);
    for (const { port, localOnly } of ports) {
      if (localOnly) continue;
      if (!card || !cardPorts(card).includes(port))
        problems.push(`overrides/${name}: publishes port ${port} to the network, but the "${cardOf(id)}" card does not use it (bind it to 127.0.0.1 or fix services.yaml)`);
      const r = reservedBy.get(port);
      if (r && r.owner !== cardOf(id)) problems.push(`overrides/${name}: port ${port} belongs to ${r.what}`);
    }
  }
  return problems;
}
