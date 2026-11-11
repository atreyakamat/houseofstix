/**
 * Runs once when the control room server starts. If ALERT_WEBHOOK_URL is set,
 * it checks every tool once a minute and sends a message when one goes down
 * or comes back (see src/lib/watch.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error("not http(s)");
  } catch {
    console.warn("[alerts] ALERT_WEBHOOK_URL is not an http(s) address; alerts are off");
    return;
  }
  const { createWatcher, sendAlert } = await import("./lib/watch");
  const { disabledIds, loadServices } = await import("./lib/services");
  const ignore = new Set((process.env.ALERT_IGNORE ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const every = Math.max(30, Number(process.env.ALERT_EVERY_SECONDS) || 60) * 1000;
  const watcher = createWatcher({});
  let running = false;
  const round = async () => {
    if (running) return;
    running = true;
    try {
      const off = disabledIds();
      const services = loadServices().filter((s) => !ignore.has(s.id) && !off.has(s.id));
      for (const change of await watcher.tick(services)) await sendAlert(url, change);
    } catch (e) {
      console.warn("[alerts] check round failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setInterval(round, every).unref();
  setTimeout(round, 15_000).unref();
  console.log(`[alerts] watching tools every ${every / 1000}s`);
}
