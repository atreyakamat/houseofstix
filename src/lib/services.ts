import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

export const TIERS = ["base", "core", "heavy", "cloud"] as const;
export type Tier = (typeof TIERS)[number];

/** A tool as configured. `health` stays on the server. */
export type Service = {
  id: string;
  name: string;
  description: string;
  icon: string;
  group: string;
  tier: Tier;
  url: string;
  health?: string;
  expect?: string;
  embed: boolean;
};

/** What the browser gets: no health addresses (they may be internal). */
export type PublicService = Omit<Service, "health" | "expect"> & { checked: boolean };

/** Fills ${NAME} and ${NAME:-default} from env. A missing name with no default becomes "". */
export function interpolate(text: string, env: Record<string, string | undefined>): string {
  return text.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, name: string, fallback?: string) => env[name] || fallback || "");
}

const isHttp = (v: string) => {
  try {
    return ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

const str = (v: unknown, field: string, where: string, required = true) => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`${where}: "${field}" is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new Error(`${where}: "${field}" must be text`);
  return v;
};

export function parseServices(yamlText: string, env: Record<string, string | undefined> = process.env): Service[] {
  const raw: unknown = parse(interpolate(yamlText, env));
  if (!Array.isArray(raw)) throw new Error("services.yaml must be a list of tools");
  const seen = new Set<string>();
  return raw.map((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const where = `services.yaml entry ${i + 1}`;
    const id = str(o.id, "id", where)!;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`${where}: id "${id}" must be lowercase letters, digits and dashes`);
    if (seen.has(id)) throw new Error(`${where}: id "${id}" is used twice`);
    seen.add(id);
    const tier = str(o.tier, "tier", where)! as Tier;
    if (!TIERS.includes(tier)) throw new Error(`${where} (${id}): tier must be one of ${TIERS.join(", ")}`);
    const url = str(o.url, "url", where)!;
    if (!isHttp(url)) throw new Error(`${where} (${id}): url must start with http:// or https://`);
    const health = str(o.health, "health", where, false);
    if (health && !isHttp(health)) throw new Error(`${where} (${id}): health must start with http:// or https://`);
    if (o.embed !== undefined && typeof o.embed !== "boolean") throw new Error(`${where} (${id}): embed must be true or false`);
    return {
      id,
      name: str(o.name, "name", where)!,
      description: str(o.description, "description", where, false) ?? "",
      icon: str(o.icon, "icon", where, false) ?? "▫️",
      group: str(o.group, "group", where, false) ?? "Tools",
      tier,
      url,
      health,
      expect: str(o.expect, "expect", where, false),
      embed: o.embed !== false,
    };
  });
}

export function loadServices(): Service[] {
  const file = resolve(process.cwd(), process.env.SERVICES_FILE || "services.yaml");
  return parseServices(readFileSync(file, "utf8"));
}

export const toPublic = (s: Service): PublicService => ({
  id: s.id,
  name: s.name,
  description: s.description,
  icon: s.icon,
  group: s.group,
  tier: s.tier,
  url: s.url,
  embed: s.embed,
  checked: Boolean(s.health),
});
