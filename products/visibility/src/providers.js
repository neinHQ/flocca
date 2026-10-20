import { createHash } from "node:crypto";
import {
  parseResponses,
  parseClaude,
  parseGemini,
} from "./response-parsers.js";
export { normalizedUrl } from "./urls.js";
export const catalog = [
  { id: "openai", name: "OpenAI Search API", implemented: true },
  { id: "perplexity", name: "Perplexity Agent API", implemented: true },
  { id: "claude", name: "Claude Search API", implemented: true },
  { id: "gemini", name: "Gemini Search Grounding API", implemented: true },
  { id: "grok", name: "Grok Search API", implemented: true },
  { id: "meta", name: "Meta Muse Spark API", implemented: true },
];
export const ADAPTER_VERSION = "visibility-2.0";
export function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export const fingerprint = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export function config(provider, env = process.env) {
  const prefix = provider.toUpperCase(),
    input = Number(env[`${prefix}_INPUT_USD_PER_MILLION`]),
    output = Number(env[`${prefix}_OUTPUT_USD_PER_MILLION`]),
    search = Number(env[`${prefix}_SEARCH_USD_PER_CALL`]),
    max = Number(env[`${prefix}_MAX_EXECUTION_USD`]);
  const searchAllowance =
    provider === "gemini" ? Number(env.GEMINI_SEARCH_RESERVE_CALLS) : 1;
  return {
    key: env[`${prefix}_API_KEY`],
    model: env[`${prefix}_MODEL`],
    approved: env[`${prefix}_TERMS_APPROVED`] === "true",
    input,
    output,
    search,
    reservation: Math.ceil(max * 1e6),
    searchAllowance,
    maxOutputTokens: 1200,
    adapterVersion: ADAPTER_VERSION,
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
      max > 0 &&
      Number.isSafeInteger(Math.ceil(max * 1e6)) &&
      Number.isInteger(searchAllowance) &&
      searchAllowance > 0 &&
      searchAllowance <= 100,
  };
}
export function snapshot(provider, env = process.env) {
  const c = config(provider, env);
  return {
    provider,
    model: c.model,
    input: c.input,
    output: c.output,
    search: c.search,
    reservation: c.reservation,
    searchAllowance: c.searchAllowance,
    maxOutputTokens: c.maxOutputTokens,
    adapterVersion: c.adapterVersion,
  };
}
export function executionConfig(provider, prompt, env = process.env) {
  const current = config(provider, env),
    frozen = prompt.executionConfig;
  if (!frozen) return current;
  if (frozen.provider !== provider || frozen.adapterVersion !== ADAPTER_VERSION)
    throw new Error(
      "Frozen provider adapter configuration is no longer compatible; create a new study",
    );
  if (!current.approved || !current.key)
    throw new Error(
      "Current provider access approval or credential is missing",
    );
  return { ...current, ...frozen, key: current.key };
}
export function coverage(env = process.env) {
  return catalog.map((p) => {
    const c = config(p.id, env);
    return {
      ...p,
      ready: !!c.key && !!c.model && c.approved && c.priced,
      status: !c.approved
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
export function requestFor(provider, prompt, c) {
  if (typeof c.model !== "string" || !c.model.trim())
    throw new Error("An explicit provider model is required");
  const input = `${prompt.text}\n\nRequested answer language: ${prompt.language}. Geographic context: ${prompt.region}.`;
  if (provider === "claude")
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": c.key, "anthropic-version": "2023-06-01" },
      body: {
        model: c.model,
        max_tokens: c.maxOutputTokens,
        messages: [{ role: "user", content: input }],
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 1 },
        ],
      },
    };
  if (provider === "gemini")
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`,
      headers: { "x-goog-api-key": c.key },
      body: {
        contents: [{ role: "user", parts: [{ text: input }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          maxOutputTokens: c.maxOutputTokens,
          candidateCount: 1,
        },
      },
    };
  const endpoints = {
    openai: "https://api.openai.com/v1/responses",
    perplexity: "https://api.perplexity.ai/v1/agent",
    grok: "https://api.x.ai/v1/responses",
    meta: "https://api.meta.ai/v1/responses",
  };
  if (!endpoints[provider]) throw new Error("Unknown provider");
  return {
    url: endpoints[provider],
    headers: { Authorization: `Bearer ${c.key}` },
    body: {
      model: c.model,
      input,
      tools: [{ type: "web_search" }],
      max_output_tokens: c.maxOutputTokens,
      max_tool_calls: 1,
      ...(provider === "perplexity" ? {} : { store: false }),
    },
  };
}
export function parseResponse(provider, raw) {
  if (!raw || typeof raw !== "object")
    throw new Error("Invalid provider response");
  return provider === "claude"
    ? parseClaude(raw)
    : provider === "gemini"
      ? parseGemini(raw)
      : parseResponses(provider, raw);
}
export async function execute(
  provider,
  prompt,
  { fetcher = fetch, env = process.env } = {},
) {
  if (!coverage(env).find((p) => p.id === provider)?.ready)
    throw new Error("Provider is not enabled");
  const c = executionConfig(provider, prompt, env),
    request = requestFor(provider, prompt, c);
  let response;
  try {
    response = await fetcher(request.url, {
      method: "POST",
      headers: { ...request.headers, "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    const e = new Error("Provider transport failure; charge uncertain");
    e.uncertain = true;
    throw e;
  }
  if (!response.ok) {
    const e = new Error(`Provider HTTP ${response.status}`);
    e.retryable = response.status === 429;
    e.uncertain = response.status >= 500;
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
  const input = parsed.usage.input_tokens,
    output = parsed.usage.output_tokens;
  const estimated =
    Number.isFinite(input) && Number.isFinite(output)
      ? Math.ceil(
          input * c.input +
            output * c.output +
            (parsed.searchCalls ?? (parsed.searched ? 1 : 0)) * c.search * 1e6,
        )
      : null;
  return {
    ...parsed,
    raw,
    request: request.body,
    configuration: prompt.executionConfig || snapshot(provider, env),
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
