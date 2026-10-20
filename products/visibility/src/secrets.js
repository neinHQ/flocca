import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key(env = process.env) {
  const k = env.VISIBILITY_EVIDENCE_KEY;
  if (!/^[a-f0-9]{64}$/i.test(k || ""))
    throw new Error(
      "VISIBILITY_EVIDENCE_KEY must be 32 random bytes encoded as hex",
    );
  return Buffer.from(k, "hex");
}
export function seal(value, tenant, env = process.env) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key(env), iv);
  c.setAAD(Buffer.from(tenant));
  const data = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
  return {
    version: 1,
    iv: iv.toString("hex"),
    tag: c.getAuthTag().toString("hex"),
    data: data.toString("base64"),
  };
}
export function unseal(value, tenant, env = process.env) {
  const c = createDecipheriv(
    "aes-256-gcm",
    key(env),
    Buffer.from(value.iv, "hex"),
  );
  c.setAAD(Buffer.from(tenant));
  c.setAuthTag(Buffer.from(value.tag, "hex"));
  return JSON.parse(
    Buffer.concat([
      c.update(Buffer.from(value.data, "base64")),
      c.final(),
    ]).toString(),
  );
}
