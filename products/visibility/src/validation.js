import { catalog, normalizedUrl } from "./providers.js";
export function text(v, name, max = 500) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new Error(`${name} must contain 1–${max} characters`);
  return v.trim();
}
export function domain(v) {
  const d = text(v, "domain", 253).toLowerCase();
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(d)
  )
    throw new Error("Use a public DNS domain without a scheme or path");
  return d;
}
function aliases(v = []) {
  if (!Array.isArray(v) || v.length > 20) throw new Error("At most 20 aliases");
  return v.map((a) => text(a, "alias", 100));
}
export function brand(v) {
  if (!Array.isArray(v.competitors || []) || (v.competitors || []).length > 20)
    throw new Error("At most 20 competitors");
  const canonicalUrls = v.canonicalUrls || [];
  if (!Array.isArray(canonicalUrls) || canonicalUrls.length > 20)
    throw new Error("At most 20 canonical URLs");
  for (const u of canonicalUrls) {
    if (
      !normalizedUrl(u) ||
      new URL(u).protocol !== "https:" ||
      new URL(u).hostname !== domain(v.domain)
    )
      throw new Error("Canonical URLs must be HTTPS pages on the brand domain");
  }
  return {
    canonicalUrls,
    name: text(v.name, "name", 100),
    domain: domain(v.domain),
    aliases: aliases(v.aliases),
    ambiguousAliases: aliases(v.ambiguousAliases),
    language: text(v.language || "en", "language", 30),
    region: text(v.region || "US", "region", 100),
    competitors: (v.competitors || []).map((c) => ({
      name: text(c.name, "competitor name", 100),
      domain: domain(c.domain),
      aliases: aliases(c.aliases),
      ambiguousAliases: aliases(c.ambiguousAliases),
    })),
  };
}
export function prompt(v) {
  const providers = v.providers;
  if (
    !Array.isArray(providers) ||
    !providers.length ||
    providers.length > 6 ||
    providers.some((p) => !catalog.some((x) => x.id === p))
  )
    throw new Error("Select known providers");
  const interval = v.intervalMinutes == null ? null : Number(v.intervalMinutes);
  if (
    interval !== null &&
    (!Number.isInteger(interval) || interval < 60 || interval > 525600)
  )
    throw new Error("Schedule must be 60–525600 minutes or null");
  return {
    text: text(v.text, "prompt", 4000),
    category: text(v.category || "unbranded", "category", 100),
    language: text(v.language || "en", "language", 30),
    region: text(v.region || "US", "region", 100),
    providers: [...new Set(providers)],
    intervalMinutes: interval,
  };
}
export const uuid = (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v || "",
  );
