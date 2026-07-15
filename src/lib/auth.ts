import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export async function isAuthenticated() {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

export {
  SESSION_COOKIE,
  checkPassword,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from "./session";
