import { timingSafeEqual } from "node:crypto";

/** True when no APP_PASSWORD is configured or the request carries it. */
export function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  const given = req.headers.get("x-app-password") ?? "";
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
