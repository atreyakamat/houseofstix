import "server-only";
import { cookies } from "next/headers";
import { authConfig, COOKIE, verifySession } from "./auth";

/** True when the request carries a valid login cookie. */
export async function isSignedIn(): Promise<boolean> {
  const cfg = authConfig();
  if (!cfg) return false;
  return verifySession((await cookies()).get(COOKIE)?.value, cfg.secret);
}
