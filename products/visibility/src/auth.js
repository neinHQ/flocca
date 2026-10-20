import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function hashPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 14 ||
    password.length > 256
  )
    throw new Error("Password must be 14–256 characters");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length > 256) return false;
  const [salt, key] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  return (
    key?.length === 128 && timingSafeEqual(actual, Buffer.from(key, "hex"))
  );
}
export function token() {
  return randomBytes(32).toString("hex");
}
export function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim().split("="))
      .filter((x) => x.length === 2),
  );
}
export async function identity(pool, req) {
  const raw = cookies(req).visibility_session;
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  return (
    (
      await pool.query(
        `SELECT u.id,u.email FROM visibility.sessions s JOIN visibility.users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled`,
        [digest(raw)],
      )
    ).rows[0] || null
  );
}
export async function membership(pool, user, tenant) {
  if (!/^[a-f0-9-]{36}$/i.test(tenant || "")) return null;
  return (
    await pool.query(
      "SELECT role FROM visibility.memberships WHERE tenant_id=$1 AND user_id=$2",
      [tenant, user],
    )
  ).rows[0];
}
