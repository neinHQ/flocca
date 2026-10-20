import { normalizedUrl } from "./urls.js";
export function parseResponses(provider, raw) {
  if (raw.status !== "completed" || raw.error || !Array.isArray(raw.output))
    throw new Error("Provider response incomplete or unsupported schema");
  if (
    raw.output.some(
      (i) =>
        i.type === "web_search_call" &&
        ["failed", "incomplete"].includes(i.status),
    )
  )
    throw new Error("Provider search tool did not complete");
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
        // Grok annotations can include merely encountered sources without a position.
        if (
          provider === "grok" &&
          (!Number.isInteger(c.start_index) ||
            !Number.isInteger(c.end_index) ||
            c.end_index <= c.start_index ||
            c.end_index > block.text.length)
        )
          continue;
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
      if (provider === "grok")
        for (const match of block.text.matchAll(
          /\[\[\d+\]\]\((https?:\/\/[^)\s]+)\)/g,
        )) {
          const url = normalizedUrl(match[1]);
          if (url)
            citations.push({
              url,
              title: "",
              evidence: block.text.slice(
                Math.max(0, match.index - 180),
                match.index + match[0].length,
              ),
              attribution: "inline_answer_reference",
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
    searchCalls:
      raw.usage?.server_side_tool_usage_details?.web_search_calls ??
      raw.output.filter((i) => i.type === "web_search_call").length,
    reportedCostMicros:
      Number.isFinite(cost) &&
      cost >= 0 &&
      (!raw.usage?.cost?.currency || raw.usage.cost.currency === "USD")
        ? Math.ceil(cost * 1e6)
        : null,
  };
}

function unique(citations) {
  return [...new Map(citations.map((c) => [c.url, c])).values()];
}
export function parseClaude(raw) {
  if (
    raw.type === "error" ||
    raw.stop_reason !== "end_turn" ||
    !Array.isArray(raw.content)
  )
    throw new Error("Claude response incomplete or unsupported schema");
  const results = raw.content.filter(
    (b) => b.type === "web_search_tool_result",
  );
  if (results.some((b) => !Array.isArray(b.content)))
    throw new Error("Claude search failed inside a successful HTTP response");
  const lastResult = raw.content.findLastIndex(
    (b) => b.type === "web_search_tool_result",
  );
  const blocks = raw.content
    .slice(lastResult + 1)
    .filter((b) => b.type === "text" && typeof b.text === "string");
  if (!blocks.length)
    throw new Error("Claude response contains no final answer text");
  const citations = [];
  for (const b of blocks)
    for (const c of b.citations || []) {
      if (c.type !== "web_search_result_location") continue;
      const url = normalizedUrl(c.url);
      if (url)
        citations.push({
          url,
          title: c.title || "",
          evidence: c.cited_text || b.text,
          answerPassage: b.text,
          attribution: "claude_web_search_citation",
        });
    }
  const searchCalls =
    raw.usage?.server_tool_use?.web_search_requests ?? results.length;
  return {
    text: blocks.map((b) => b.text).join("\n"),
    citations: unique(citations),
    searched: results.length > 0 || searchCalls > 0,
    searchCalls,
    model: raw.model,
    usage: raw.usage || {},
    reportedCostMicros: null,
  };
}
export function parseGemini(raw) {
  const candidate = raw.candidates?.[0];
  if (
    raw.error ||
    candidate?.finishReason !== "STOP" ||
    !Array.isArray(candidate.content?.parts)
  )
    throw new Error(
      "Gemini response blocked, incomplete or unsupported schema",
    );
  const text = candidate.content.parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("\n");
  if (!text.trim())
    throw new Error("Gemini response contains no final answer text");
  const g = candidate.groundingMetadata || {},
    citations = [];
  for (const support of g.groundingSupports || [])
    for (const index of support.groundingChunkIndices || []) {
      const source = g.groundingChunks?.[index]?.web,
        url = normalizedUrl(source?.uri);
      if (!url) continue;
      const unresolvedRedirect =
        new URL(url).hostname === "vertexaisearch.cloud.google.com";
      citations.push({
        url,
        title: source.title || "",
        evidence:
          support.segment?.text ||
          text.slice(
            support.segment?.startIndex || 0,
            support.segment?.endIndex || text.length,
          ),
        attribution: "gemini_grounding_support",
        ...(unresolvedRedirect ? { unresolvedRedirect: true } : {}),
      });
    }
  const usage = raw.usageMetadata || {};
  return {
    text,
    citations: unique(citations),
    searched:
      (g.webSearchQueries || []).length > 0 ||
      (g.groundingSupports || []).length > 0,
    searchCalls: (g.webSearchQueries || []).length,
    model: raw.modelVersion,
    usage: {
      ...usage,
      input_tokens: usage.promptTokenCount,
      output_tokens: Number.isFinite(usage.candidatesTokenCount)
        ? usage.candidatesTokenCount + (usage.thoughtsTokenCount || 0)
        : undefined,
    },
    reportedCostMicros: null,
    providerMetadata: {
      searchSuggestions: g.searchEntryPoint?.renderedContent || null,
      searchQueries: g.webSearchQueries || [],
    },
  };
}
