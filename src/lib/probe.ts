/** "off" = switched off on purpose in deploy/stack.conf, so not checked and not an alarm. */
export type Probe = { state: "up" | "down" | "unchecked" | "off"; ms?: number; code?: number };

/**
 * Asks one tool's health address if it is alive. Up = a reply under 400 that
 * contains `expect` (when given). Anything else, including a timeout, is down.
 * No health address means we don't know, which is not the same as down.
 */
export async function probe(
  target: { health?: string; expect?: string },
  { fetchImpl = fetch, timeoutMs = 3000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Probe> {
  if (!target.health) return { state: "unchecked" };
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(target.health, { signal: ctl.signal, cache: "no-store", redirect: "follow" });
    const ms = Date.now() - started;
    if (res.status >= 400) return { state: "down", ms, code: res.status };
    if (target.expect && !(await res.text()).includes(target.expect)) return { state: "down", ms, code: res.status };
    return { state: "up", ms, code: res.status };
  } catch {
    return { state: "down" };
  } finally {
    clearTimeout(timer);
  }
}
