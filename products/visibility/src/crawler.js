import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import { load } from "cheerio";
import { normalizedUrl } from "./providers.js";
export const AGENT = "FloccaVisibilityBot";
export function publicAddress(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && ip.isIPv4MappedAddress())
      ip = ip.toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolvePublic(input, resolver = lookup) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Only public HTTPS URLs on port 443 are allowed");
  const addresses = await resolver(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("Private or reserved network target blocked");
  return { url, address: addresses[0] };
}
export async function safeFetch(
  input,
  { redirects = 0, resolver = lookup } = {},
) {
  if (redirects > 4) throw new Error("Too many redirects");
  const { url, address } = await resolvePublic(input, resolver);
  const response = await new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": `${AGENT}/0.1 (+https://flocca.app)`,
          Accept: "text/html,application/xml,text/plain;q=0.9",
          "Accept-Encoding": "identity",
        },
        lookup: (_host, opts, cb) =>
          opts.all
            ? cb(null, [address])
            : cb(null, address.address, address.family),
        timeout: 12000,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 2_000_000) {
            res.destroy(new Error("Response exceeds 2 MB limit"));
          } else chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            url: url.href,
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            redirects: [],
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Crawl timed out")));
    req.on("error", reject);
  });
  if (
    [301, 302, 303, 307, 308].includes(response.status) &&
    response.headers.location
  ) {
    const target = new URL(response.headers.location, url).href;
    // The crawler separately checks robots before requesting an arbitrary redirected page.
    return { ...response, redirect: target };
  }
  return response;
}
export function analyzePage(page) {
  const $ = load(page.body);
  const findings = [];
  const add = (code, severity, evidence, remediation, verification) =>
    findings.push({
      code,
      severity,
      url: page.url,
      evidence,
      remediation,
      verification,
    });
  if (page.status !== 200)
    add(
      "http_status",
      "high",
      `HTTP ${page.status}`,
      "Resolve unexpected response status.",
      "Fetch the URL again and verify the intended status.",
    );
  if (page.redirect)
    add(
      "redirect",
      "info",
      `${page.status} → ${page.redirect}`,
      "Check that this is the intended canonical destination.",
      "Follow the redirect and verify canonical metadata.",
    );
  if (!$("title").text().trim())
    add(
      "missing_title",
      "medium",
      "No non-empty <title>",
      "Add a descriptive page title.",
      "Inspect the HTML title after deployment.",
    );
  if (!$('meta[name="description" i]').attr("content")?.trim())
    add(
      "missing_description",
      "medium",
      "No meta description",
      "Add an accurate description of the page.",
      "Inspect the deployed meta description.",
    );
  const canonical = $('link[rel="canonical" i]').attr("href");
  if (!canonical)
    add(
      "missing_canonical",
      "medium",
      "No canonical link",
      "Declare the preferred canonical URL.",
      "Verify a single canonical URL points to an indexable page.",
    );
  else {
    let valid = false;
    try {
      valid = !!normalizedUrl(new URL(canonical, page.url).href);
    } catch {}
    if (!valid)
      add(
        "invalid_canonical",
        "medium",
        canonical,
        "Use an HTTP or HTTPS canonical URL.",
        "Fetch the canonical URL.",
      );
  }
  const directives = [
    $('meta[name="robots" i]').attr("content"),
    page.headers["x-robots-tag"],
  ]
    .filter(Boolean)
    .join("; ");
  if (/\bnoindex\b/i.test(directives))
    add(
      "noindex",
      "high",
      directives,
      "Confirm whether this public page should be indexable.",
      "Verify robots metadata and response headers after any change.",
    );
  let schemas = 0;
  $('script[type="application/ld+json"]').each((_, node) => {
    schemas++;
    try {
      JSON.parse($(node).text());
    } catch {
      add(
        "invalid_jsonld",
        "medium",
        $(node).text().slice(0, 400),
        "Repair invalid JSON-LD syntax.",
        "Validate the deployed JSON-LD; syntax validity does not establish semantic correctness.",
      );
    }
  });
  if (!schemas)
    add(
      "no_jsonld",
      "info",
      "No JSON-LD found",
      "Consider relevant structured data that accurately describes this page.",
      "Validate applicable schema; structured data does not guarantee citations.",
    );
  $("script,style,noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  if (text.length < 120)
    add(
      "limited_html_text",
      "medium",
      `${text.length} visible-text characters in fetched HTML`,
      "Check whether important content depends on JavaScript rendering.",
      "Compare fetched HTML and browser-rendered content.",
    );
  return {
    url: page.url,
    status: page.status,
    title: $("title").text(),
    canonical: canonical || null,
    htmlTextLength: text.length,
    findings,
    indexability: "Signals only; search engine indexing not verified",
  };
}
export async function audit(
  domain,
  {
    fetcher = safeFetch,
    maxPages = 12,
    delayMs = 1000,
    renderer = null,
    urls = [],
  } = {},
) {
  const root = `https://${domain}/`,
    origin = new URL(root).origin;
  const findings = [],
    pages = [],
    queue = [root, ...urls],
    seen = new Set(),
    robots = new Map();
  let requests = 0;
  const maxRequests = maxPages * 6;
  let chain = Promise.resolve();
  const request = (url) => {
    const next = chain.then(async () => {
      if (++requests > maxRequests)
        throw new Error("Audit request limit reached");
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return fetcher(url);
    });
    chain = next.catch(() => {});
    return next;
  };
  async function policy(url) {
    const o = new URL(url).origin;
    if (!robots.has(o)) {
      const r = await request(`${o}/robots.txt`);
      if (r.status !== 200 && r.status !== 404)
        throw new Error(
          `Robots policy unavailable (HTTP ${r.status}); crawl stopped`,
        );
      robots.set(
        o,
        robotsParser(`${o}/robots.txt`, r.status === 404 ? "" : r.body),
      );
      if (r.status === 404)
        findings.push({
          code: "robots_missing",
          severity: "info",
          url: `${o}/robots.txt`,
          evidence: "HTTP 404",
          remediation: "Consider publishing an explicit robots policy.",
          verification: "Fetch robots.txt.",
        });
    }
    return robots.get(o);
  }
  async function allowedFetch(url, hops = 0) {
    if (hops > 4) throw new Error("Too many redirects");
    const p = await policy(url);
    if (p.isAllowed(url, AGENT) === false)
      throw new Error(`Robots disallows ${url}`);
    const crawlDelay = p.getCrawlDelay(AGENT);
    if (crawlDelay > 30)
      throw new Error("Crawl delay exceeds supported audit window");
    if (crawlDelay && crawlDelay * 1000 > delayMs)
      await new Promise((r) => setTimeout(r, crawlDelay * 1000 - delayMs));
    const r = await request(url);
    if (r.redirect) {
      if (new URL(r.redirect).origin !== origin)
        throw new Error(
          "Cross-origin redirect requires a separately authorized brand domain",
        );
      const final = await allowedFetch(r.redirect, hops + 1);
      final.redirects = [
        { url, status: r.status, target: r.redirect },
        ...(final.redirects || []),
      ];
      return final;
    }
    return r;
  }
  let p;
  try {
    p = await policy(root);
  } catch (e) {
    return {
      pages,
      findings: [
        {
          code: "robots_unavailable",
          severity: "high",
          url: root,
          evidence: e.message,
          remediation: "Restore a readable public robots policy.",
          verification: "Rerun the audit.",
        },
      ],
      partial: true,
      renderVisibility: "not evaluated",
    };
  }
  const sitemapUrls = [
    ...new Set([
      `${origin}/sitemap.xml`,
      ...p.getSitemaps().filter((u) => {
        try {
          return new URL(u).origin === origin;
        } catch {
          return false;
        }
      }),
    ]),
  ].slice(0, 4);
  for (const u of sitemapUrls)
    try {
      const map = await allowedFetch(u);
      if (map.status !== 200)
        findings.push({
          code: "sitemap_unavailable",
          severity: "medium",
          url: u,
          evidence: `HTTP ${map.status}`,
          remediation: "Publish a valid sitemap of canonical public pages.",
          verification: "Fetch sitemap and verify its URLs.",
        });
      else {
        const xml = load(map.body, { xml: true });
        // Bounded sitemap-index support, no external domains.
        if (xml("sitemapindex").length)
          for (const el of xml("sitemap > loc").slice(0, 2).toArray()) {
            const child = xml(el).text().trim();
            if (new URL(child).origin !== origin) continue;
            const nested = await allowedFetch(child);
            const n = load(nested.body, { xml: true });
            n("url > loc")
              .slice(0, maxPages)
              .each((_, e) => queue.push(n(e).text().trim()));
          }
        else
          xml("url > loc")
            .slice(0, maxPages)
            .each((_, e) => queue.push(xml(e).text().trim()));
      }
    } catch (e) {
      findings.push({
        code: "sitemap_error",
        severity: "medium",
        url: u,
        evidence: e.message,
        remediation: "Check sitemap access and format.",
        verification: "Rerun the audit.",
      });
    }
  while (queue.length && pages.length < maxPages && requests < maxRequests) {
    const input = queue.shift();
    let url;
    try {
      url = new URL(input);
      if (url.origin !== origin || url.username || url.password) continue;
      url.hash = "";
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const page = await allowedFetch(url.href);
      const result = analyzePage(page);
      const rules = await policy(page.url);
      result.robotsSignals = [
        "OAI-SearchBot",
        "Claude-SearchBot",
        "PerplexityBot",
        "Googlebot",
      ].map((bot) => ({
        bot,
        allowed: rules.isAllowed(page.url, bot) !== false,
      }));
      for (const signal of result.robotsSignals.filter((s) => !s.allowed))
        result.findings.push({
          code: "robots_bot_blocked",
          severity: "medium",
          url: page.url,
          evidence: `${signal.bot} is disallowed by ${new URL(page.url).origin}/robots.txt`,
          remediation:
            "Review whether this crawler restriction is intended; preserve intentional access policies.",
          verification:
            "Fetch robots.txt and evaluate the bot-specific rule. Access permission does not establish indexing or citations.",
        });

      result.redirects = page.redirects;
      if (renderer && page.status === 200)
        try {
          result.render = await renderer(page, allowedFetch);
        } catch (e) {
          result.render = { status: "failed", reason: e.message };
        }
      else
        result.render = {
          status: "not_evaluated",
          reason: "Browser rendering is not configured",
        };
      pages.push(result);
      const $ = load(page.body);
      $("a[href]")
        .slice(0, 40)
        .each((_, e) => {
          try {
            queue.push(new URL($(e).attr("href"), page.url).href);
          } catch {}
        });
    } catch (e) {
      pages.push({
        url: url?.href || input,
        status: null,
        findings: [
          {
            code: "fetch_blocked_or_failed",
            severity: "high",
            url: input,
            evidence: e.message,
            remediation:
              "Check authorization, public reachability and robots policy.",
            verification: "Rerun the audit after resolving the issue.",
          },
        ],
      });
    }
  }
  return {
    pages,
    findings,
    partial: queue.length > 0 || pages.some((p) => !p.status),
    requests,
    renderVisibility: renderer
      ? "browser comparison attempted"
      : "not evaluated",
    methodology:
      "Bounded public HTTPS crawl; robots respected; no claim of actual search indexing or citation impact.",
  };
}
