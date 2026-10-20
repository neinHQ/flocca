import { phase2Suite } from "./phase2-suite.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { render } from "../src/renderer.js";
import { createServer } from "node:http";
import { database, transaction, enqueue, reserve } from "../src/db.js";
import { hashPassword } from "../src/auth.js";
import { migrate } from "../scripts/manage.js";
import { app } from "../src/api.js";
import { processOne, schedule, recover } from "../src/worker.js";
const url = process.env.VISIBILITY_TEST_DATABASE_URL;
const env = {
  VISIBILITY_EVIDENCE_KEY: "b".repeat(64),
  OPENAI_API_KEY: "fixture-not-real",
  OPENAI_MODEL: "fixture-model",
  OPENAI_TERMS_APPROVED: "true",
  OPENAI_INPUT_USD_PER_MILLION: "1",
  OPENAI_OUTPUT_USD_PER_MILLION: "2",
  OPENAI_SEARCH_USD_PER_CALL: ".01",
  OPENAI_MAX_EXECUTION_USD: ".1",
  PERPLEXITY_API_KEY: "fixture-not-real",
  PERPLEXITY_MODEL: "fixture-model",
  PERPLEXITY_TERMS_APPROVED: "true",
  PERPLEXITY_INPUT_USD_PER_MILLION: "1",
  PERPLEXITY_OUTPUT_USD_PER_MILLION: "2",
  PERPLEXITY_SEARCH_USD_PER_CALL: ".01",
  PERPLEXITY_MAX_EXECUTION_USD: ".1",
};
const fixture = async (provider, p) => ({
  model: "fixture-model",
  text: `${p.brand.name} is useful.`,
  searched: true,
  citations: [{ url: `https://${p.brand.domain}/`, title: p.brand.name }],
  usage: { input_tokens: 10, output_tokens: 20 },
  costMicros: 10000,
  costKind: "provider_reported",
  request: { model: "fixture-model", tools: [{ type: "web_search" }] },
  raw: { fixture: true, provider },
  localeControl: "prompt context only",
});
test("PostgreSQL product integration", { skip: !url }, async (t) => {
  if (!new URL(url).pathname.endsWith("visibility_test"))
    throw new Error(
      "Integration tests require a disposable database ending in visibility_test",
    );
  const pool = database(url);
  await migrate(pool);
  await migrate(pool);
  const server = createServer(app(pool, { env }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  env.VISIBILITY_PUBLIC_ORIGIN = base;
  const tenants = [randomUUID(), randomUUID()],
    users = [randomUUID(), randomUUID()],
    password = "internal fixture password";
  try {
    await pool.query(
      "TRUNCATE visibility.tenants,visibility.users,visibility.provider_throttle CASCADE",
    );
    for (let i = 0; i < 2; i++)
      await transaction(pool, async (c) => {
        await c.query(
          "INSERT INTO visibility.tenants(id,name,monthly_cap_micros) VALUES($1,$2,1000000)",
          [tenants[i], `Tenant ${i}`],
        );
        await c.query("INSERT INTO visibility.users VALUES($1,$2,$3,false)", [
          users[i],
          `user${i}@example.test`,
          hashPassword(password),
        ]);
        await c.query(
          "INSERT INTO visibility.memberships VALUES($1,$2,'OWNER')",
          [tenants[i], users[i]],
        );
      });
    let sessions = [];
    async function call(
      path,
      {
        method = "GET",
        body,
        who = 0,
        tenant = tenants[who],
        headers = {},
      } = {},
    ) {
      const r = await fetch(`${base}/api/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(sessions[who] ? { Cookie: sessions[who] } : {}),
          "X-Visibility-Tenant": tenant,
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: r.status,
        data: r.headers.get("content-type")?.includes("application/json")
          ? await r.json()
          : await r.text(),
        headers: r.headers,
      };
    }
    await t.test(
      "login issues an HttpOnly cookie, rejects wrong credentials and forged identity",
      async () => {
        const bad = await call("login", {
          method: "POST",
          body: { email: "user0@example.test", password: "wrong" },
        });
        assert.equal(bad.status, 401);
        for (let i = 0; i < 2; i++) {
          const r = await call("login", {
            method: "POST",
            body: { email: `user${i}@example.test`, password },
          });
          assert.equal(r.status, 200);
          const cookie = r.headers.get("set-cookie");
          assert.match(cookie, /HttpOnly/);
          assert.match(cookie, /SameSite=Strict/);
          sessions[i] = cookie.split(";")[0];
        }
        const r = await fetch(`${base}/api/state`, {
          headers: {
            "x-flocca-user-id": users[0],
            "X-Visibility-Tenant": tenants[0],
          },
        });
        assert.equal(r.status, 401);
        assert.equal(
          (await call("state", { who: 1, tenant: tenants[0] })).status,
          403,
        );
        assert.equal(
          (
            await call("brands", {
              method: "POST",
              body: { name: "x", domain: "x.example" },
              headers: { Origin: "https://evil.example" },
            })
          ).status,
          403,
        );
      },
    );
    const brands = [];
    await t.test(
      "two tenants independently create and edit brands; foreign brands are inaccessible",
      async () => {
        for (let i = 0; i < 2; i++) {
          const r = await call("brands", {
            method: "POST",
            who: i,
            body: {
              name: `Brand${i}`,
              domain: `brand${i}.example`,
              competitors: [],
            },
          });
          assert.equal(r.status, 201);
          brands[i] = r.data.id;
        }
        assert.equal(
          (await call(`brands/${brands[0]}/report`, { who: 1 })).status,
          404,
        );
        assert.equal(
          (
            await call(`brands/${brands[0]}`, {
              who: 1,
              method: "PUT",
              body: { name: "hijack", domain: "evil.example" },
            })
          ).status,
          404,
        );
        const r = await call("state", { who: 1 });
        assert.deepEqual(
          r.data.brands.map((b) => b.id),
          [brands[1]],
        );
      },
    );
    let promptId;
    await t.test(
      "prompt imports are atomic, versions immutable, and pause supported",
      async () => {
        const path = `brands/${brands[0]}/prompts`;
        const invalid = await call(path, {
          method: "POST",
          body: {
            prompts: [
              { text: "valid", providers: ["openai"] },
              { text: "", providers: ["openai"] },
            ],
          },
        });
        assert.equal(invalid.status, 400);
        assert.equal((await call("state")).data.prompts.length, 0);
        const r = await call(path, {
          method: "POST",
          body: {
            text: "Which tools?",
            providers: ["openai", "perplexity"],
            intervalMinutes: 60,
          },
        });
        assert.equal(r.status, 201);
        promptId = r.data.ids[0];
        assert.equal(
          (
            await call(`${path}/${promptId}`, {
              method: "PUT",
              body: { active: false, text: "Updated question" },
            })
          ).status,
          200,
        );
        const versions = (
          await pool.query(
            "SELECT * FROM visibility.prompt_versions WHERE tenant_id=$1 AND prompt_id=$2 ORDER BY version",
            [tenants[0], promptId],
          )
        ).rows;
        assert.equal(versions.length, 2);
        assert.equal(versions[0].data.text, "Which tools?");
        assert.equal(versions[1].data.text, "Updated question");
        assert.equal(
          (await call(`brands/${brands[0]}/run`, { method: "POST", body: {} }))
            .status,
          409,
        );
        await call(`${path}/${promptId}`, {
          method: "PUT",
          body: { active: true },
        });
      },
    );
    await t.test(
      "scheduler is idempotent under concurrent dispatch and collapses missed intervals",
      async () => {
        await Promise.all([schedule(pool), schedule(pool)]);
        const jobs = (
          await pool.query("SELECT * FROM visibility.jobs WHERE tenant_id=$1", [
            tenants[0],
          ])
        ).rows;
        assert.equal(jobs.length, 2);
        assert.equal(new Set(jobs.map((j) => j.dedupe_key)).size, 2);
        assert.equal(await schedule(pool), 0);
        await pool.query("UPDATE visibility.jobs SET status='cancelled'");
      },
    );
    await t.test(
      "two brands can complete the audit and two-provider monitor loop using explicit test fixtures",
      async () => {
        for (let i = 0; i < 2; i++) {
          if (i === 1)
            await call(`brands/${brands[i]}/prompts`, {
              who: i,
              method: "POST",
              body: {
                text: "Which tools?",
                providers: ["openai", "perplexity"],
              },
            });
          const auditJob = await call(`brands/${brands[i]}/audit`, {
            who: i,
            method: "POST",
            body: {},
          });
          assert.equal(auditJob.status, 202);
          await processOne(pool, {
            env,
            auditor: async (domain) => ({
              pages: [
                {
                  url: `https://${domain}/`,
                  status: 200,
                  findings: [
                    {
                      code: "missing_title",
                      severity: "medium",
                      url: `https://${domain}/`,
                      evidence: "Missing title",
                      remediation: "Add title",
                      verification: "Re-audit",
                    },
                  ],
                },
              ],
              findings: [],
              partial: false,
              renderVisibility: "test fixture",
              methodology: "Synthetic test fixture only",
            }),
          });
          assert.equal(
            (
              await call(`brands/${brands[i]}/run`, {
                who: i,
                method: "POST",
                body: {},
              })
            ).status,
            202,
          );
          await pool.query("TRUNCATE visibility.provider_throttle");
          await processOne(pool, { env, runner: fixture });
          await pool.query("TRUNCATE visibility.provider_throttle");
          await processOne(pool, { env, runner: fixture });
          const r = await call(`brands/${brands[i]}/report`, { who: i });
          assert.equal(r.data.runs.length, 2);
          assert.equal(r.data.audits.length, 1);
          assert.equal(r.data.cohorts.length, 2);
          assert.equal(r.data.cohorts[0].citation.rate, 1);
          assert.equal(r.data.runs[0].data.raw, undefined);
        }
      },
    );
    await t.test(
      "evidence, filters, reports and exports enforce tenant scope",
      async () => {
        const r = await call(`brands/${brands[0]}/report`),
          id = r.data.runs[0].id;
        const own = await call(`brands/${brands[0]}/evidence/${id}`);
        assert.equal(own.data.raw.fixture, true);
        assert.equal(
          (await call(`brands/${brands[1]}/evidence/${id}`, { who: 1 })).status,
          404,
        );
        assert.equal(
          (await call(`brands/${brands[0]}/report?provider=openai`)).data.runs
            .length,
          1,
        );
        assert.equal(
          (await call(`brands/${brands[0]}/report?from=2099-01-01`)).data.runs
            .length,
          0,
        );
        const csv = await call(`brands/${brands[0]}/report.csv`);
        assert.equal(csv.status, 200);
        assert.match(csv.data, /Official API samples/);
        assert.ok(!csv.data.includes("fixture-not-real"));
        assert.equal(
          (await call(`brands/${brands[0]}/report.csv`, { who: 1 })).status,
          404,
        );
      },
    );
    await t.test(
      "deployed changes, recommendations and referral attribution persist",
      async () => {
        const r = await call(`brands/${brands[0]}/report`),
          auditId = r.data.audits[0].id;
        assert.equal(
          (
            await call(`brands/${brands[0]}/changes`, {
              method: "POST",
              body: {
                description: "Add title",
                link: "https://github.com/example/repo/pull/1",
                findingId: `${auditId}:0`,
                deployedAt: new Date().toISOString(),
              },
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await call(`brands/${brands[0]}/referrals`, {
              method: "POST",
              body: {
                source: "test export",
                rows: [
                  {
                    date: "2026-10-20",
                    referrer: "https://perplexity.ai/search?q=private",
                    count: 4,
                  },
                  { date: "2026-10-20", referrer: "", count: 7 },
                ],
              },
            })
          ).status,
          201,
        );
        const report = (await call(`brands/${brands[0]}/report`)).data;
        assert.equal(report.changes.length, 1);
        assert.equal(
          report.referrals[0].data.classification,
          "known_ai_referral",
        );
        assert.equal(
          report.referrals[0].data.referrer,
          "https://perplexity.ai",
        );
      },
    );
    await t.test(
      "member roles cannot mutate state and client-supplied role does not override access",
      async () => {
        await pool.query(
          "UPDATE visibility.memberships SET role='MEMBER' WHERE user_id=$1",
          [users[1]],
        );
        assert.equal(
          (
            await call(`brands/${brands[1]}/audit`, {
              who: 1,
              method: "POST",
              body: { role: "OWNER", userId: users[0] },
            })
          ).status,
          403,
        );
        assert.equal((await call("state", { who: 1 })).status, 200);
      },
    );
    await t.test(
      "concurrent reservations cannot oversubscribe monthly tenant budget",
      async () => {
        const id = await transaction(pool, (c) =>
          enqueue(c, tenants[0], brands[0], "monitor", {}),
        );
        await pool.query(
          "UPDATE visibility.tenants SET monthly_cap_micros=25000 WHERE id=$1",
          [tenants[0]],
        );
        // Prior completed jobs consumed 20,000 micros. Only one 4,000 reservation can fit.
        const results = await Promise.allSettled(
          Array.from({ length: 8 }, () =>
            transaction(pool, (c) =>
              reserve(c, tenants[0], id.id, "openai", 4000),
            ),
          ),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        await pool.query(
          "UPDATE visibility.jobs SET status='cancelled' WHERE id=$1",
          [id.id],
        );
      },
    );
    await t.test(
      "worker stops at spend cap before calling a provider",
      async () => {
        await transaction(pool, (c) =>
          enqueue(c, tenants[0], brands[0], "monitor", {
            provider: "openai",
            text: "hello",
            language: "en",
            region: "US",
            brand: { name: "Brand0", domain: "brand0.example" },
          }),
        );
        await pool.query("TRUNCATE visibility.provider_throttle");
        let called = false;
        await processOne(pool, {
          env,
          runner: async () => {
            called = true;
          },
        });
        assert.equal(called, false);
        assert.ok(
          (await call("state")).data.jobs.some(
            (j) => j.error === "Monthly spend cap reached",
          ),
        );
      },
    );
    await t.test(
      "duplicate manual jobs with the same key dispatch only once",
      async () => {
        const headers = { "Idempotency-Key": "repeat-transport-request" };
        const first = await call(`brands/${brands[1]}/run`, {
          who: 0,
          tenant: tenants[1],
          method: "POST",
          body: {},
          headers,
        });
        // User0 has no membership in tenant1, even with a valid idempotency key.
        assert.equal(first.status, 403);
        await pool.query(
          "UPDATE visibility.memberships SET role='OWNER' WHERE user_id=$1",
          [users[1]],
        );
        const a = await call(`brands/${brands[1]}/run`, {
          who: 1,
          method: "POST",
          body: {},
          headers,
        });
        const b = await call(`brands/${brands[1]}/run`, {
          who: 1,
          method: "POST",
          body: {},
          headers,
        });
        assert.equal(a.status, 202);
        assert.equal(b.status, 202);
        assert.deepEqual(
          a.data.jobs.map((j) => j.id),
          b.data.jobs.map((j) => j.id),
        );
        await pool.query(
          "UPDATE visibility.jobs SET status='cancelled' WHERE tenant_id=$1 AND status='queued'",
          [tenants[1]],
        );
      },
    );
    await t.test(
      "uncertain charges retain reservation and are not automatically retried",
      async () => {
        const job = await transaction(pool, (c) =>
          enqueue(c, tenants[1], brands[1], "monitor", {
            provider: "openai",
            text: "hello",
            language: "en",
            region: "US",
            brand: { name: "Brand1", domain: "brand1.example" },
          }),
        );
        await pool.query("TRUNCATE visibility.provider_throttle");
        let calls = 0;
        await processOne(pool, {
          env,
          runner: async () => {
            calls++;
            const e = new Error("timeout");
            e.uncertain = true;
            throw e;
          },
        });
        assert.equal(calls, 1);
        const saved = (
          await pool.query(
            "SELECT * FROM visibility.jobs WHERE tenant_id=$1 AND id=$2",
            [tenants[1], job.id],
          )
        ).rows[0];
        assert.equal(saved.status, "uncertain");
        const usage = (
          await pool.query(
            "SELECT * FROM visibility.usage WHERE tenant_id=$1 AND job_id=$2",
            [tenants[1], job.id],
          )
        ).rows[0];
        assert.equal(usage.actual_micros, null);
        assert.equal(usage.state, "unknown");
        await processOne(pool, {
          env,
          runner: async () => {
            calls++;
          },
        });
        assert.equal(calls, 1);
      },
    );
    await t.test(
      "interrupted monitoring jobs become uncertain; audit jobs recover safely",
      async () => {
        const jobs = [];
        for (const kind of ["monitor", "audit"])
          jobs.push(
            await transaction(pool, (c) =>
              enqueue(c, tenants[1], brands[1], kind, {}),
            ),
          );
        for (const job of jobs)
          await pool.query(
            "UPDATE visibility.jobs SET status='running',started_at=now()-interval '11 minutes',attempts=1 WHERE tenant_id=$1 AND id=$2",
            [tenants[1], job.id],
          );
        await recover(pool);
        const result = (
          await pool.query(
            "SELECT kind,status FROM visibility.jobs WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
            [tenants[1], jobs.map((j) => j.id)],
          )
        ).rows;
        assert.equal(
          result.find((j) => j.kind === "monitor").status,
          "uncertain",
        );
        assert.equal(result.find((j) => j.kind === "audit").status, "queued");
      },
    );
    await t.test(
      "429 rejections retry at most three times without retaining a rejected charge",
      async () => {
        const job = await transaction(pool, (c) =>
          enqueue(c, tenants[1], brands[1], "monitor", {
            provider: "openai",
            text: "hello",
            language: "en",
            region: "US",
            brand: { name: "Brand1", domain: "brand1.example" },
          }),
        );
        // Clear the intentionally recovered audit fixture before dispatching this job.
        await pool.query(
          "UPDATE visibility.jobs SET status='cancelled' WHERE kind='audit' AND status='queued'",
        );
        let calls = 0;
        for (let i = 0; i < 3; i++) {
          await pool.query("TRUNCATE visibility.provider_throttle");
          await pool.query(
            "UPDATE visibility.jobs SET available_at=now() WHERE tenant_id=$1 AND id=$2",
            [tenants[1], job.id],
          );
          await processOne(pool, {
            env,
            runner: async () => {
              calls++;
              const e = new Error("Provider HTTP 429");
              e.retryable = true;
              throw e;
            },
          });
        }
        const saved = (
          await pool.query(
            "SELECT * FROM visibility.jobs WHERE tenant_id=$1 AND id=$2",
            [tenants[1], job.id],
          )
        ).rows[0];
        assert.equal(calls, 3);
        assert.equal(saved.status, "failed");
        assert.equal(saved.attempts, 3);
        const usage = (
          await pool.query(
            "SELECT * FROM visibility.usage WHERE tenant_id=$1 AND job_id=$2",
            [tenants[1], job.id],
          )
        ).rows;
        assert.equal(usage.length, 3);
        assert.ok(
          usage.every(
            (u) => Number(u.actual_micros) === 0 && u.state === "rejected",
          ),
        );
      },
    );
    await t.test(
      "configured-rate estimates retain conservative spend reservations",
      async () => {
        const job = await transaction(pool, (c) =>
          enqueue(c, tenants[1], brands[1], "monitor", {
            provider: "openai",
            text: "hello",
            language: "en",
            region: "US",
            brand: { name: "Brand1", domain: "brand1.example" },
          }),
        );
        await pool.query("TRUNCATE visibility.provider_throttle");
        await processOne(pool, {
          env,
          runner: async (provider, p) => ({
            ...(await fixture(provider, p)),
            costKind: "configured_rate_estimate",
          }),
        });
        const usage = (
          await pool.query(
            "SELECT * FROM visibility.usage WHERE tenant_id=$1 AND job_id=$2",
            [tenants[1], job.id],
          )
        ).rows[0];
        assert.equal(usage.actual_micros, null);
        assert.equal(usage.state, "estimated_reserved");
      },
    );
    await t.test(
      "browser dashboard supports sign in, brand setup, reports and mobile layout",
      { skip: process.env.VISIBILITY_BROWSER_TESTS !== "true" },
      async () => {
        const browser = await chromium.launch({
          headless: true,
          timeout: 20000,
        });
        try {
          const page = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
          });
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(base);
          await page.locator("#login [name=email]").fill("user0@example.test");
          await page.locator("#login [name=password]").fill(password);
          await page.locator("#login button").click();
          try {
            await page
              .locator("#workspace")
              .waitFor({ state: "visible", timeout: 10000 });
          } catch (e) {
            throw new Error(
              `Dashboard login failed: ${await page.locator("#notice").textContent()}; ${errors.join("; ")}`,
            );
          }
          await page
            .getByText("Create or edit a brand", { exact: true })
            .click();
          await page.locator("#brand-form [name=name]").fill("Browser Brand");
          await page
            .locator("#brand-form [name=domain]")
            .fill("browser.example");
          await page
            .locator(
              "#brand-form button[type=submit], #brand-form button:not([type])",
            )
            .click();
          await page.waitForFunction(
            () =>
              document.querySelector("#brand option:checked")?.textContent ===
              "Browser Brand",
          );
          await page.locator("#brand").selectOption(brands[0]);
          await page
            .getByRole("button", { name: "Inspect", exact: true })
            .first()
            .waitFor();
          await page
            .getByRole("button", { name: "Inspect", exact: true })
            .first()
            .click();
          await page.locator("#evidence").waitFor({ state: "visible" });
          assert.match(
            await page.locator("#evidence").textContent(),
            /fixture/,
          );
          const dir = process.env.VISIBILITY_SCREENSHOT_DIR || "/private/tmp";
          await mkdir(dir, { recursive: true });
          await page.screenshot({
            path: `${dir}/flocca-visibility-desktop.png`,
            fullPage: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.screenshot({
            path: `${dir}/flocca-visibility-mobile.png`,
            fullPage: true,
          });
          assert.deepEqual(errors, []);
          assert.equal(
            await page
              .locator("body")
              .evaluate((el) => el.scrollWidth <= window.innerWidth),
            true,
          );
        } finally {
          await browser.close();
        }
      },
    );
    await t.test(
      "isolated browser rendering detects JavaScript-only content and blocks external resources",
      { skip: process.env.VISIBILITY_BROWSER_TESTS !== "true" },
      async () => {
        const page = {
          url: "https://render.example/",
          status: 200,
          headers: { "content-type": "text/html" },
          body: '<html><body><div id="app"></div><script>document.getElementById("app").textContent="Visible content ".repeat(40)</script></body></html>',
        };
        const result = await render(page, async () => {
          throw new Error("No extra resources expected");
        });
        assert.equal(result.status, "completed");
        assert.equal(result.contentDependsOnRendering, true);
      },
    );
    await phase2Suite(t, {
      pool,
      call,
      tenants,
      users,
      brands,
      env,
      base,
      password,
    });
    await t.test("logout revokes session", async () => {
      await call("logout", { method: "POST", body: {} });
      assert.equal((await call("me")).status, 401);
    });
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await pool.end();
  }
});
