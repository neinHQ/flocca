export const catalog = [
  { id: "openai", name: "OpenAI Search API", implemented: true },
  { id: "perplexity", name: "Perplexity Agent API", implemented: true },
  { id: "claude", name: "Claude", implemented: false },
  { id: "gemini", name: "Gemini", implemented: false },
  { id: "grok", name: "Grok", implemented: false },
  { id: "meta", name: "Meta Muse Spark", implemented: false },
];
export function config(provider, env = process.env) {
  const prefix = provider.toUpperCase();
  const input = Number(env[`${prefix}_INPUT_USD_PER_MILLION`]);
  const output = Number(env[`${prefix}_OUTPUT_USD_PER_MILLION`]);
  const search = Number(env[`${prefix}_SEARCH_USD_PER_CALL`]);
  const max = Number(env[`${prefix}_MAX_EXECUTION_USD`]);
  return {
    key: env[`${prefix}_API_KEY`],
    model: env[`${prefix}_MODEL`],
    approved: env[`${prefix}_TERMS_APPROVED`] === "true",
    input,
    output,
    search,
    reservation: Math.ceil(max * 1e6),
    priced:
      [
        "INPUT_USD_PER_MILLION",
        "OUTPUT_USD_PER_MILLION",
        "SEARCH_USD_PER_CALL",
        "MAX_EXECUTION_USD",
      ].every(
        (s) =>
          typeof env[`${prefix}_${s}`] === "string" &&
          env[`${prefix}_${s}`].trim() !== "",
      ) &&
      [input, output, search, max].every(Number.isFinite) &&
      input >= 0 &&
      output >= 0 &&
      search >= 0 &&
      max > 0,
  };
}
export function coverage(env = process.env) {
  return catalog.map((p) => {
    const c = config(p.id, env);
    return {
      ...p,
      ready: p.implemented && !!c.key && !!c.model && c.approved && c.priced,
      status: !p.implemented
        ? "planned"
        : !c.approved
          ? "terms approval required"
          : !c.key || !c.model
            ? "credentials/model required"
            : !c.priced
              ? "pricing/budget required"
              : "configured; live validation required",
      model: c.model || null,
      surface: "official API; not consumer-app rankings",
    };
  });
}
export function normalizedUrl(input) {
  try {
    const u = new URL(input);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^utm_|^(gclid|fbclid)$/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch {
    return null;
  }
}
export function parseResponse(provider, raw) {
  if (raw.status !== "completed" || !Array.isArray(raw.output))
    throw new Error("Provider response incomplete or unsupported schema");
  const texts = [],
    citations = [];
  const sources = new Map();
  for (const item of raw.output)
    if (item.type === "search_results")
      for (const r of item.results || []) sources.set(String(r.id), r);
  let searched = raw.output.some((i) =>
    ["web_search_call", "search_results"].includes(i.type),
  );
  for (const item of raw.output) {
    if (item.type !== "message") continue;
    for (const block of item.content || []) {
      if (block.type !== "output_text" || typeof block.text !== "string")
        continue;
      texts.push(block.text);
      for (const a of block.annotations || []) {
        const c = a.url_citation || a;
        if (a.type !== "url_citation") continue;
        const url = normalizedUrl(c.url);
        if (url)
          citations.push({
            url,
            title: c.title || "",
            evidence: block.text.slice(
              c.start_index || 0,
              c.end_index || block.text.length,
            ),
            attribution: "provider_annotation",
          });
      }
      // Perplexity can supply numbered answer references with separate search results.
      if (provider === "perplexity")
        for (const match of block.text.matchAll(/\[(\d+)\]/g)) {
          const source = sources.get(match[1]);
          const url = normalizedUrl(source?.url);
          if (url)
            citations.push({
              url,
              title: source.title || "",
              evidence: block.text.slice(
                Math.max(0, match.index - 180),
                match.index + match[0].length,
              ),
              attribution: "numbered_answer_reference",
            });
        }
    }
  }
  if (!texts.length)
    throw new Error("Provider response contains no answer text");
  const cost = raw.usage?.cost?.total_cost;
  return {
    text: texts.join("\n"),
    citations: [...new Map(citations.map((c) => [c.url, c])).values()],
    searched,
    model: raw.model,
    usage: raw.usage || {},
    reportedCostMicros:
      Number.isFinite(cost) && cost >= 0 ? Math.ceil(cost * 1e6) : null,
  };
}
export async function execute(
  provider,
  prompt,
  { fetcher = fetch, env = process.env } = {},
) {
  const c = config(provider, env);
  if (!coverage(env).find((p) => p.id === provider)?.ready)
    throw new Error("Provider is not enabled");
  const input = `${prompt.text}\n\nRequested answer language: ${prompt.language}. Geographic context: ${prompt.region}.`;
  const body = {
    model: c.model,
    input,
    tools: [{ type: "web_search" }],
    max_output_tokens: 1200,
    ...(provider === "openai"
      ? { store: false, max_tool_calls: 1 }
      : { max_tool_calls: 1 }),
  };
  let response;
  try {
    response = await fetcher(
      provider === "openai"
        ? "https://api.openai.com/v1/responses"
        : "https://api.perplexity.ai/v1/agent",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      },
    );
  } catch {
    const e = new Error("Provider transport failure; charge uncertain");
    e.uncertain = true;
    throw e;
  }
  if (!response.ok) {
    const e = new Error(`Provider HTTP ${response.status}`);
    e.retryable = response.status === 429;
    e.uncertain = response.status >= 500;
    // Provider error bodies may echo prompts or credentials; never log them.
    throw e;
  }
  let raw, parsed;
  try {
    raw = await response.json();
    parsed = parseResponse(provider, raw);
  } catch (e) {
    e.uncertain = true;
    e.raw = raw;
    throw e;
  }
  const inputTokens = parsed.usage.input_tokens,
    outputTokens = parsed.usage.output_tokens;
  const searches = raw.output.filter(
    (i) => i.type === "web_search_call",
  ).length;
  const estimated =
    Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
      ? Math.ceil(
          inputTokens * c.input +
            outputTokens * c.output +
            Math.max(searches, parsed.searched ? 1 : 0) * c.search * 1e6,
        )
      : null;
  return {
    ...parsed,
    raw,
    request: body,
    costMicros: parsed.reportedCostMicros ?? estimated,
    costKind:
      parsed.reportedCostMicros !== null
        ? "provider_reported"
        : estimated !== null
          ? "configured_rate_estimate"
          : "unknown",
    localeControl:
      "prompt context only; not a guaranteed location or language setting",
  };
}
