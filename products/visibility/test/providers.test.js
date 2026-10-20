import test from "node:test";
import assert from "node:assert/strict";
import {
  parseResponse,
  execute,
  config,
  snapshot,
  coverage,
  requestFor,
  fingerprint,
} from "../src/providers.js";
import {
  accuracy,
  confusion,
  thresholds,
  reviewResult,
} from "../src/quality.js";
import { summarize, mentions } from "../src/metrics.js";
const env = { GEMINI_SEARCH_RESERVE_CALLS: "3" };
for (const p of ["OPENAI", "PERPLEXITY", "CLAUDE", "GEMINI", "GROK", "META"])
  Object.assign(env, {
    [`${p}_API_KEY`]: "synthetic-key",
    [`${p}_MODEL`]: "explicit-model",
    [`${p}_TERMS_APPROVED`]: "true",
    [`${p}_INPUT_USD_PER_MILLION`]: "1",
    [`${p}_OUTPUT_USD_PER_MILLION`]: "2",
    [`${p}_SEARCH_USD_PER_CALL`]: ".01",
    [`${p}_MAX_EXECUTION_USD`]: "1",
  });
export function rawFixture(provider) {
  if (provider === "claude")
    return {
      model: "explicit-model",
      stop_reason: "end_turn",
      content: [
        { type: "text", text: "I will search for Brand0." },
        { type: "server_tool_use", name: "web_search" },
        {
          type: "web_search_tool_result",
          content: [{ url: "https://unused.example" }],
        },
        {
          type: "text",
          text: "Brand0 is useful.",
          citations: [
            {
              type: "web_search_result_location",
              url: "https://brand0.example/",
              title: "Brand0",
              cited_text: "Brand0 is useful.",
            },
          ],
        },
      ],
      usage: {
        input_tokens: 30,
        output_tokens: 40,
        server_tool_use: { web_search_requests: 1 },
      },
    };
  if (provider === "gemini")
    return {
      modelVersion: "explicit-model",
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { text: "Hidden thought", thought: true },
              { text: "Brand0 is useful." },
            ],
          },
          groundingMetadata: {
            webSearchQueries: ["Brand0"],
            groundingChunks: [
              { web: { uri: "https://unused.example" } },
              { web: { uri: "https://brand0.example/", title: "Brand0" } },
            ],
            groundingSupports: [
              {
                segment: {
                  startIndex: 0,
                  endIndex: 16,
                  text: "Brand0 is useful.",
                },
                groundingChunkIndices: [1],
              },
            ],
            searchEntryPoint: {
              renderedContent: "<div>Search suggestions</div>",
            },
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 30,
        candidatesTokenCount: 40,
        thoughtsTokenCount: 5,
      },
    };
  return {
    status: "completed",
    model: "explicit-model",
    output: [
      { type: "web_search_call", status: "completed" },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text:
              provider === "grok"
                ? "Brand0 is useful. [[1]](https://brand0.example/)"
                : "Brand0 is useful.",
            annotations: [
              {
                type: "url_citation",
                url: "https://brand0.example/",
                title: "Brand0",
                start_index: 0,
                end_index: 16,
              },
            ],
          },
        ],
      },
    ],
    usage: { input_tokens: 30, output_tokens: 40 },
    citations: ["https://unused.example"],
  };
}
for (const provider of [
  "openai",
  "perplexity",
  "claude",
  "gemini",
  "grok",
  "meta",
])
  test(`${provider}: explicit official contract, normalized evidence and credential confinement`, async () => {
    let request;
    const result = await execute(
      provider,
      { text: "Which tools?", region: "US", language: "en" },
      {
        env,
        fetcher: async (url, options) => {
          request = { url, ...options, body: JSON.parse(options.body) };
          return { ok: true, json: async () => rawFixture(provider) };
        },
      },
    );
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].url, "https://brand0.example/");
    assert.equal(result.searched, true);
    assert.ok(result.costMicros > 0);
    assert.equal(result.costKind, "configured_rate_estimate");
    assert.ok(!JSON.stringify(result.request).includes("synthetic-key"));
    assert.ok(
      !JSON.stringify(snapshot(provider, env)).includes("synthetic-key"),
    );
    const hosts = {
      openai: "api.openai.com",
      perplexity: "api.perplexity.ai",
      claude: "api.anthropic.com",
      gemini: "generativelanguage.googleapis.com",
      grok: "api.x.ai",
      meta: "api.meta.ai",
    };
    assert.equal(new URL(request.url).hostname, hosts[provider]);
    if (provider === "claude") {
      assert.equal(request.headers["x-api-key"], "synthetic-key");
      assert.equal(request.body.tools[0].max_uses, 1);
      assert.ok(!result.text.includes("I will search"));
    }
    if (provider === "gemini") {
      assert.equal(request.headers["x-goog-api-key"], "synthetic-key");
      assert.equal(result.usage.output_tokens, 45);
      assert.ok(!result.text.includes("Hidden thought"));
      assert.ok(result.providerMetadata.searchSuggestions);
    }
  });
test("Grok encountered source lists and unpositioned annotations are not answer citations", () => {
  const raw = rawFixture("grok");
  raw.output[1].content[0].text = "Unlinked brand mention.";
  raw.output[1].content[0].annotations = [
    { type: "url_citation", url: "https://candidate.example" },
  ];
  assert.equal(parseResponse("grok", raw).citations.length, 0);
});
test("Gemini uses only supported chunks; opaque redirects are not false negative domain observations", () => {
  const raw = rawFixture("gemini");
  raw.candidates[0].groundingMetadata.groundingChunks[1].web.uri =
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/token";
  const parsed = parseResponse("gemini", raw);
  assert.equal(parsed.citations[0].unresolvedRedirect, true);
  const s = summarize([{ ...parsed, status: "completed", mentions: [] }], {
    domain: "brand0.example",
  });
  assert.equal(s.mention.denominator, 1);
  assert.equal(s.citation.denominator, 0);
  assert.equal(s.citation.rate, null);
});
test("Claude HTTP-200 search errors and paused turns are not eligible observations", () => {
  const raw = rawFixture("claude");
  raw.content[2].content = {
    type: "web_search_tool_result_error",
    error_code: "unavailable",
  };
  assert.throws(() => parseResponse("claude", raw));
  assert.throws(() =>
    parseResponse("claude", {
      ...rawFixture("claude"),
      stop_reason: "pause_turn",
    }),
  );
});
test("Gemini blocked and truncated outputs fail closed", () => {
  const raw = rawFixture("gemini");
  raw.candidates[0].finishReason = "MAX_TOKENS";
  assert.throws(() => parseResponse("gemini", raw));
  assert.throws(() =>
    parseResponse("gemini", { promptFeedback: { blockReason: "SAFETY" } }),
  );
});
test("frozen provider model is used when environment changes and incompatible adapters are rejected", async () => {
  const frozen = snapshot("meta", env),
    changed = { ...env, META_MODEL: "new-model" };
  let body;
  await execute(
    "meta",
    { text: "hello", region: "US", language: "en", executionConfig: frozen },
    {
      env: changed,
      fetcher: async (_url, o) => {
        body = JSON.parse(o.body);
        return { ok: true, json: async () => rawFixture("meta") };
      },
    },
  );
  assert.equal(body.model, "explicit-model");
  await assert.rejects(
    execute(
      "meta",
      { text: "x", executionConfig: { ...frozen, adapterVersion: "old" } },
      { env },
    ),
    /no longer compatible/,
  );
  assert.equal(fingerprint({ b: 1, a: 2 }), fingerprint({ a: 2, b: 1 }));
});
test("Gemini search allowance is explicit and all six providers remain fail-closed without configuration", () => {
  assert.equal(coverage({}).filter((p) => p.ready).length, 0);
  assert.equal(coverage(env).filter((p) => p.ready).length, 6);
  assert.equal(
    coverage({ ...env, GEMINI_SEARCH_RESERVE_CALLS: "" }).find(
      (p) => p.id === "gemini",
    ).ready,
    false,
  );
});
test("review confusion matrices retain false positives, false negatives and empty-denominator uncertainty", () => {
  assert.deepEqual(confusion(["a", "b"], ["b", "c"]), { tp: 1, fp: 1, fn: 1 });
  assert.deepEqual(accuracy([]), {
    tp: 0,
    fp: 0,
    fn: 0,
    precision: null,
    recall: null,
  });
  assert.equal(accuracy([{ tp: 1, fp: 1, fn: 0 }]).precision, 0.5);
  assert.throws(() => thresholds({ minReviewedPerProvider: 0 }));
  assert.throws(() => thresholds({ minPrecision: 1.1 }));
  const r = reviewResult(
    {
      citations: [],
      mentions: [{ domain: "brand.example", mentioned: true, uncertain: true }],
    },
    {
      citationUrls: ["https://brand.example/"],
      mentionDomains: ["brand.example"],
    },
  );
  assert.equal(r.citations.fn, 1);
  assert.equal(r.mentions.fn, 1);
});

test("citation URL targets alone do not create brand mentions, while visible link labels do", () => {
  const brand = { name: "Flocca", domain: "flocca.app", aliases: [] };
  assert.equal(
    mentions("Useful tools [[1]](https://flocca.app/)", brand)[0].mentioned,
    false,
  );
  assert.equal(
    mentions("Sources: https://flocca.app/", brand)[0].mentioned,
    false,
  );
  assert.equal(
    mentions("Try [Flocca](https://flocca.app/).", brand)[0].mentioned,
    true,
  );
});
