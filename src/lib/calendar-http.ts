import "server-only";
import { sameOrigin } from "./auth";
import { isSignedIn } from "./session";

const MAX_BODY = 512 * 1024; // a pop-up sheet CSV is a few KB; this is plenty

/** Null when the request may go ahead; otherwise the response to send back. */
export async function guard(req: Request, writes = false): Promise<Response | null> {
  if (!(await isSignedIn())) return Response.json({ error: "Sign in first" }, { status: 401 });
  if (writes && !sameOrigin(req)) return Response.json({ error: "Not allowed from another site" }, { status: 403 });
  return null;
}

/** Reads a JSON body of at most MAX_BODY bytes. Throws a message fit to show. */
export async function readJson(req: Request): Promise<unknown> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) throw new Error("That's too big to save (512 KB max).");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error("That's too big to save (512 KB max).");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The request wasn't valid JSON.");
  }
}

export const bad = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : "Something went wrong" }, { status });
export const noStore = { "Cache-Control": "no-store" };
