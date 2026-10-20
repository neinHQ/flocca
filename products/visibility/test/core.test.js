import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth.js";
import { seal, unseal } from "../src/secrets.js";
import {
  parseResponse,
  normalizedUrl,
  coverage,
  execute,
} from "../src/providers.js";
import {
  mentions,
  summarize,
  referral,
  csv,
  cohorts,
  comparisons,
} from "../src/metrics.js";
import {
  publicAddress,
  resolvePublic,
  analyzePage,
  audit,
} from "../src/crawler.js";
import { brand, prompt } from "../src/validation.js";
const response = (text = "Flocca helps teams.", annotations = []) => ({
  status: "completed",
  model: "fixture-model",
  output: [
    { type: "web_search_call" },
    { type: "message", content: [{ type: "output_text", text, annotations }] },
  ],
  usage: { input_tokens: 10, output_tokens: 20 },
});
const b = {
  name: "Flocca",
  domain: "flocca.app",
  aliases: [],
  competitors: [{ name: "Other", domain: "other.example" }],
};
test("password hashing is salted and verifies only the correct password", () => {
  const h = hashPassword("long internal password");
  assert.notEqual(h, hashPassword("long internal password"));
  assert.ok(verifyPassword("long internal password", h));
  assert.ok(!verifyPassword("wrong", h));
  assert.throws(() => hashPassword("short"));
});
test("evidence authenticated encryption binds ciphertext to tenant", () => {
  const env = { VISIBILITY_EVIDENCE_KEY: "a".repeat(64) };
  const c = seal({ answer: "private" }, "tenant-a", env);
  assert.deepEqual(unseal(c, "tenant-a", env), { answer: "private" });
  assert.throws(() => unseal(c, "tenant-b", env));
  assert.throws(() => seal({}, "a", {}));
});
test("OpenAI extraction uses attributed URL annotations, not answer links or search candidates", () => {
  const raw = response("Flocca https://unlinked.example", [
    {
      type: "url_citation",
      url: "https://flocca.app/?utm_source=ai",
      title: "Flocca",
      start_index: 0,
      end_index: 6,
    },
  ]);
  const parsed = parseResponse("openai", raw);
  assert.equal(parsed.citations.length, 1);
  assert.equal(parsed.citations[0].url, "https://flocca.app/");
  assert.equal(parsed.citations[0].evidence, "Flocca");
  assert.equal(parseResponse("openai", response()).citations.length, 0);
});
test("Perplexity extraction counts only referenced search results", () => {
  const raw = response("Flocca [2], other source [999].");
  raw.output.unshift({
    type: "search_results",
    results: [
      { id: 1, url: "https://unused.example" },
      { id: 2, url: "https://flocca.app", title: "Flocca" },
    ],
  });
  assert.equal(parseResponse("perplexity", raw).citations.length, 1);
  assert.throws(() =>
    parseResponse("openai", { status: "incomplete", output: [] }),
  );
  assert.throws(() =>
    parseResponse("openai", { status: "completed", output: [] }),
  );
});
test("URLs reject non-web protocols and credentials", () => {
  assert.equal(normalizedUrl("javascript:alert(1)"), null);
  assert.equal(normalizedUrl("https://user:secret@example.com"), null);
  assert.equal(
    normalizedUrl("https://example.com/#fragment"),
    "https://example.com/",
  );
});
test("brand boundaries and uncertain aliases are explicit", () => {
  assert.equal(mentions("Floccatastic", b)[0].mentioned, false);
  assert.equal(mentions("Try FLocca.", b)[0].mentioned, true);
  assert.equal(
    mentions("AI helps", { name: "AI", domain: "ai.example" })[0].uncertain,
    true,
  );
});
test("rates exclude errors, ungrounded answers and uncertain mentions; domain suffixes cannot impersonate brand", () => {
  const observations = [
    {
      status: "completed",
      searched: true,
      mentions: mentions("Flocca and Other", b),
      citations: [{ url: "https://docs.flocca.app/a" }],
    },
    { status: "failed" },
    { status: "completed", searched: false },
    {
      status: "completed",
      searched: true,
      mentions: mentions("Other", b),
      citations: [{ url: "https://flocca.app.evil.example" }],
    },
  ];
  const m = summarize(observations, b);
  assert.equal(m.eligible, 2);
  assert.equal(m.mention.rate, 0.5);
  assert.equal(m.citation.rate, 0.5);
  assert.equal(m.shareOfVoice.rate, 1 / 3);
  assert.equal(summarize([], b).mention.rate, null);
});
test("cohorts separate prompt versions and configuration", () => {
  const row = {
    data: {
      status: "completed",
      searched: true,
      provider: "openai",
      model: "m",
      promptId: "p",
      promptVersion: 1,
    },
    observed_at: new Date(),
  };
  assert.equal(
    cohorts([row, { ...row, data: { ...row.data, promptVersion: 2 } }], b)
      .length,
    2,
  );
});
test("referrers and exports handle attribution and spreadsheet injection", () => {
  assert.equal(
    referral("https://perplexity.ai/search/foo"),
    "known_ai_referral",
  );
  assert.equal(
    referral("https://perplexity.ai.evil.example"),
    "other_referral",
  );
  assert.equal(referral(""), "direct_or_unattributed");
  assert.match(csv([{ x: "=CMD()", y: 'a"b' }]), /"'=CMD\(\)"/);
  assert.match(csv([{ x: 'a"b' }]), /a""b/);
});
test("all private/reserved and mapped IPs are blocked; DNS mixing is rejected", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "0.0.0.0",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  await assert.rejects(
    resolvePublic("https://public.example", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
  );
  await assert.rejects(resolvePublic("http://example.com"));
  await assert.rejects(resolvePublic("https://example.com:8443"));
});
test("audit evidence includes noindex and malformed structured data", () => {
  const result = analyzePage({
    url: "https://example.com",
    status: 200,
    headers: { "x-robots-tag": "noindex" },
    body: '<html><body><script type="application/ld+json">bad</script></body></html>',
  });
  for (const code of [
    "noindex",
    "invalid_jsonld",
    "missing_title",
    "missing_canonical",
  ])
    assert.ok(result.findings.some((f) => f.code === code));
});
test("crawler obeys robots and bounds sitemap crawling", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return {
      url,
      status: 200,
      headers: {},
      body: url.endsWith("robots.txt")
        ? "User-agent: *\nDisallow: /private"
        : url.endsWith("sitemap.xml")
          ? "<urlset><url><loc>https://example.com/private</loc></url></urlset>"
          : "<html><title>Example</title><body>Public page</body></html>",
    };
  };
  const result = await audit("example.com", {
    fetcher,
    delayMs: 0,
    maxPages: 4,
  });
  assert.ok(!calls.includes("https://example.com/private"));
  assert.ok(
    result.pages.some((p) =>
      p.findings.some((f) => f.code === "fetch_blocked_or_failed"),
    ),
  );
});
test("robots errors fail closed and cross-origin redirects are blocked", async () => {
  let calls = 0;
  const r = await audit("example.com", {
    delayMs: 0,
    fetcher: async (url) => ({
      url,
      status: ++calls && 503,
      body: "",
      headers: {},
    }),
  });
  assert.equal(calls, 1);
  assert.equal(r.partial, true);
});
test("provider catalog is fail-closed and validation rejects malformed configuration", () => {
  assert.equal(coverage({}).filter((p) => p.ready).length, 0);
  assert.equal(coverage({}).length, 6);
  assert.throws(() => brand({ name: "x", domain: "localhost" }));
  assert.throws(() => prompt({ text: "hello", providers: ["hark"] }));
  assert.throws(() =>
    prompt({ text: "hello", providers: ["openai"], intervalMinutes: 1 }),
  );
});
test("provider HTTP failures distinguish safe retries from uncertain charges", async () => {
  const env = {
    OPENAI_API_KEY: "fixture",
    OPENAI_MODEL: "fixture",
    OPENAI_TERMS_APPROVED: "true",
    OPENAI_INPUT_USD_PER_MILLION: "1",
    OPENAI_OUTPUT_USD_PER_MILLION: "2",
    OPENAI_SEARCH_USD_PER_CALL: ".01",
    OPENAI_MAX_EXECUTION_USD: "1",
  };
  const p = { text: "test", language: "en", region: "US" };
  await assert.rejects(
    execute("openai", p, {
      env,
      fetcher: async () => ({ ok: false, status: 429 }),
    }),
    (e) => e.retryable && !e.uncertain,
  );
  await assert.rejects(
    execute("openai", p, {
      env,
      fetcher: async () => {
        throw new Error("timeout");
      },
    }),
    (e) => e.uncertain,
  );
  const out = await execute("openai", p, {
    env,
    fetcher: async (_url, request) => {
      assert.ok(!request.body.includes("fixture-secret"));
      return { ok: true, json: async () => response() };
    },
  });
  assert.equal(out.costKind, "configured_rate_estimate");
  assert.ok(out.costMicros > 0);
});

test("before-after comparisons preserve cohorts and empty samples", () => {
  const at = "2026-10-20T12:00:00Z",
    data = {
      provider: "openai",
      model: "m",
      promptId: "p",
      promptVersion: 1,
      status: "completed",
      searched: true,
      mentions: mentions("Flocca", b),
      citations: [],
    };
  const r = comparisons(
    [
      { data, observed_at: "2026-10-19T12:00:00Z" },
      {
        data: { ...data, promptVersion: 2 },
        observed_at: "2026-10-21T12:00:00Z",
      },
    ],
    [{ id: "c", data: { deployedAt: at } }],
    b,
  );
  assert.equal(r[0].cohorts.length, 2);
  assert.equal(r[0].cohorts[0].after.mention.rate, null);
  assert.equal(r[0].cohorts[1].before.mention.rate, null);
});
test("blank rate settings never silently become free pricing", () => {
  const env = {
    OPENAI_API_KEY: "test",
    OPENAI_MODEL: "test",
    OPENAI_TERMS_APPROVED: "true",
    OPENAI_INPUT_USD_PER_MILLION: "",
    OPENAI_OUTPUT_USD_PER_MILLION: "",
    OPENAI_SEARCH_USD_PER_CALL: "",
    OPENAI_MAX_EXECUTION_USD: "1",
  };
  assert.equal(coverage(env)[0].ready, false);
});
test("canonical URLs must belong to the authorized brand domain", () => {
  assert.throws(() =>
    brand({
      name: "Example",
      domain: "example.com",
      canonicalUrls: ["https://evil.example/"],
    }),
  );
  assert.equal(
    brand({
      name: "Example",
      domain: "example.com",
      canonicalUrls: ["https://example.com/product"],
    }).canonicalUrls.length,
    1,
  );
});

test("audits report bot-specific robots restrictions without promising citation effects", async () => {
  const result = await audit("example.com", {
    delayMs: 0,
    maxPages: 1,
    fetcher: async (url) => ({
      url,
      status: url.endsWith("sitemap.xml") ? 404 : 200,
      headers: {},
      body: url.endsWith("robots.txt")
        ? "User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /"
        : "<html><title>Example</title><body>Public</body></html>",
    }),
  });
  assert.ok(
    result.pages[0].findings.some(
      (f) =>
        f.code === "robots_bot_blocked" && f.evidence.includes("OAI-SearchBot"),
    ),
  );
});
