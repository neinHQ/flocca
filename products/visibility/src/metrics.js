import { normalizedUrl, canonical } from "./providers.js";
export function domainMatch(url, domain) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}
export function mentions(text, brand) {
  // Citation targets and bare URLs are not prose mentions. Preserve visible link labels.
  const answerText = text
    .replace(/!?\[([^\]]*)\]\(https?:\/\/[^)]*\)/gi, "$1")
    .replace(/https?:\/\/[^\s<>)\]]+/gi, "");
  const entities = [
    {
      name: brand.name,
      aliases: brand.aliases || [],
      ambiguousAliases: brand.ambiguousAliases || [],
      domain: brand.domain,
    },
    ...(brand.competitors || []),
  ];
  return entities.map((entity) => {
    const aliases = [entity.name, ...(entity.aliases || [])].filter(Boolean);
    const matches = aliases.filter((a) => {
      const escaped = a
        .normalize("NFKC")
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
        "iu",
      ).test(answerText.normalize("NFKC"));
    });
    return {
      name: entity.name,
      domain: entity.domain,
      mentioned: matches.length > 0,
      matches,
      uncertain:
        matches.some((a) => a.length < 4) ||
        matches.some((a) => (entity.ambiguousAliases || []).includes(a)),
    };
  });
}
export function summarize(executions, brand, planned = executions.length) {
  const eligible = executions.filter(
    (e) => e.status === "completed" && e.searched,
  );
  const n = eligible.length;
  const matched = eligible.filter((e) =>
    e.mentions?.some(
      (m) => m.domain === brand.domain && m.mentioned && !m.uncertain,
    ),
  ).length;
  const citationEligible = eligible.filter(
    (e) => !e.citations?.some((c) => c.unresolvedRedirect),
  );
  const cited = citationEligible.filter((e) =>
    e.citations?.some((c) => domainMatch(c.url, brand.domain)),
  ).length;
  const allMentions = eligible
    .flatMap((e) => e.mentions || [])
    .filter((m) => m.mentioned && !m.uncertain);
  return {
    eligible: n,
    planned,
    completed: executions.filter((e) => e.status === "completed").length,
    mention: {
      numerator: matched,
      denominator: n,
      rate: n ? matched / n : null,
    },
    citation: {
      numerator: cited,
      denominator: citationEligible.length,
      rate: citationEligible.length ? cited / citationEligible.length : null,
    },
    unresolvedCitationResponses: n - citationEligible.length,
    shareOfVoice: {
      numerator: matched,
      denominator: allMentions.length,
      rate: allMentions.length ? matched / allMentions.length : null,
    },
    coverage: planned ? n / planned : null,
    uncertainMatches: eligible
      .flatMap((e) => e.mentions || [])
      .filter((m) => m.uncertain && m.mentioned).length,
  };
}
export function cohortKey(d) {
  return JSON.stringify(
    canonical([
      d.provider,
      d.model,
      d.promptId,
      d.promptVersion,
      d.language,
      d.region,
      d.parameters,
      d.brandSnapshot,
    ]),
  );
}
export function cohorts(rows, brand) {
  const groups = new Map();
  for (const row of rows) {
    const d = row.data;
    const key = cohortKey(d);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...d, observedAt: row.observed_at });
  }
  return [...groups.values()].map((r) => ({
    brandDomain: r[0].brandSnapshot?.domain || brand.domain,
    provider: r[0].provider,
    model: r[0].model,
    promptId: r[0].promptId,
    promptVersion: r[0].promptVersion,
    language: r[0].language,
    region: r[0].region,
    parameters: r[0].parameters,
    lastRun: r.at(-1).observedAt,
    ...summarize(r, r[0].brandSnapshot || brand),
    daily: [
      ...new Set(
        r.map((x) => new Date(x.observedAt).toISOString().slice(0, 10)),
      ),
    ].map((day) => ({
      day,
      ...summarize(
        r.filter((x) => new Date(x.observedAt).toISOString().startsWith(day)),
        r[0].brandSnapshot || brand,
      ),
    })),
    observations: r.map((x) => ({
      at: x.observedAt,
      status: x.status,
      mentioned:
        x.mentions?.some(
          (m) =>
            m.domain === (r[0].brandSnapshot || brand).domain &&
            m.mentioned &&
            !m.uncertain,
        ) || false,
      cited:
        x.citations?.some((c) =>
          domainMatch(c.url, (r[0].brandSnapshot || brand).domain),
        ) || false,
    })),
  }));
}
export function referral(referrer) {
  const url = normalizedUrl(referrer);
  if (!url) return "direct_or_unattributed";
  const domains = [
    "chatgpt.com",
    "chat.openai.com",
    "perplexity.ai",
    "claude.ai",
    "gemini.google.com",
    "grok.com",
    "meta.ai",
    "muse.ai",
  ];
  return domains.some((d) => domainMatch(url, d))
    ? "known_ai_referral"
    : "other_referral";
}
export function csv(rows) {
  const cell = (v) => {
    let s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  if (!rows.length) return '"No observations"\r\n';
  const keys = [...new Set(rows.flatMap(Object.keys))];
  return [
    keys.map(cell).join(","),
    ...rows.map((r) => keys.map((k) => cell(r[k])).join(",")),
  ].join("\r\n");
}

export function comparisons(rows, changes, brand) {
  const window = 7 * 86400000;
  return changes.map((change) => {
    const at = Date.parse(change.data.deployedAt),
      groups = new Map();
    for (const row of rows) {
      const time = Date.parse(row.observed_at);
      if (time < at - window || time >= at + window) continue;
      const key = cohortKey(row.data);
      if (!groups.has(key))
        groups.set(key, {
          configuration: {
            provider: row.data.provider,
            model: row.data.model,
            promptId: row.data.promptId,
            promptVersion: row.data.promptVersion,
            language: row.data.language,
            region: row.data.region,
          },
          brand: row.data.brandSnapshot || brand,
          before: [],
          after: [],
        });
      groups.get(key)[time < at ? "before" : "after"].push(row.data);
    }
    return {
      changeId: change.id,
      deployedAt: change.data.deployedAt,
      windowDays: 7,
      cohorts: [...groups.values()].map((g) => ({
        configuration: g.configuration,
        before: summarize(g.before, g.brand),
        after: summarize(g.after, g.brand),
      })),
    };
  });
}
