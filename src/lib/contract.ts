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
  for (const raw of text.split("\n")) {
    const item = raw.trim();
    if (!item.startsWith("-")) continue;
    const parts = item.slice(1).trim().replaceAll(/["']/g, "").split("/")[0].split(":");
    if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^[\d.]+$/.test(p))) continue;
    const host = parts.length === 3 ? parts[0] : "";
    out.push({ port: Number(parts.at(-2)), localOnly: host === "127.0.0.1" });
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

type Input = { services: Service[]; stack: StackEntry[]; overrides: Record<string, string>; reserved: Reserved[] };
const cardOf = (id: string) => STACK_TO_CARD[id] ?? id;
const reservedMap = (reserved: Reserved[]) => new Map(reserved.map((r) => [r.port, r]));

/** Every tool stixctl runs has a card, and that card is health-checked. */
function checkCards({ services, stack }: Input): string[] {
  const cards = new Map(services.map((s) => [s.id, s]));
  const problems: string[] = [];
  for (const e of stack.filter((e) => !NO_CARD.has(e.id))) {
    const card = cards.get(cardOf(e.id));
    if (!card) problems.push(`stack.conf "${e.id}" has no card in services.yaml (expected id "${cardOf(e.id)}")`);
    else if (!card.health) problems.push(`services.yaml "${card.id}": runs on the home lab but has no health address, so nobody would notice it is down`);
  }
  return problems;
}

/** Every home-lab card is either run by stixctl or owns a reserved port (an existing program). */
function checkStrayCards({ services, stack, reserved }: Input): string[] {
  const carded = new Set(stack.map((e) => cardOf(e.id)));
  const reservedBy = reservedMap(reserved);
  return services
    .filter((s) => isLocal(s) && !carded.has(s.id))
    .filter((s) => !cardPorts(s).some((p) => reservedBy.get(p)?.owner === s.id))
    .map((s) => `services.yaml "${s.id}": not in stack.conf and not an existing program in reserved-ports.conf`);
}

/** No two tools share a host port, and nobody takes a port another program owns. */
function checkPorts({ services, reserved }: Input): string[] {
  const problems: string[] = [];
  const reservedBy = reservedMap(reserved);
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
  return problems;
}

/** One override file per stack id, and every port it publishes to the network is the tool's card port. */
function checkOverride(name: string, text: string, { services, stack, reserved }: Input): string[] {
  const id = name.replace(/\.ya?ml$/, "");
  if (!stack.some((e) => e.id === id)) return [`overrides/${name}: no tool "${id}" in stack.conf, so stixctl never uses it`];
  const card = services.find((s) => s.id === cardOf(id));
  const reservedBy = reservedMap(reserved);
  const ports = overridePorts(text);
  const problems: string[] = [];
  if (ports.length === 0) problems.push(`overrides/${name}: publishes no ports (use !override with a list of "host:container")`);
  for (const { port } of ports.filter((p) => !p.localOnly)) {
    if (!card || !cardPorts(card).includes(port))
      problems.push(`overrides/${name}: publishes port ${port} to the network, but the "${cardOf(id)}" card does not use it (bind it to 127.0.0.1 or fix services.yaml)`);
    const r = reservedBy.get(port);
    if (r && r.owner !== cardOf(id)) problems.push(`overrides/${name}: port ${port} belongs to ${r.what}`);
  }
  return problems;
}

export function checkContract(input: Input): string[] {
  return [
    ...checkCards(input),
    ...checkStrayCards(input),
    ...checkPorts(input),
    ...Object.entries(input.overrides).flatMap(([name, text]) => checkOverride(name, text, input)),
  ];
}
