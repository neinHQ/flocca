import { phase2Browser } from "./phase2-browser.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { processOne } from "../src/worker.js";
import { enqueue, transaction } from "../src/db.js";
export async function phase2Suite(
  t,
  { pool, call, tenants, users, brands, env, base, password },
) {
  await pool.query("UPDATE visibility.tenants SET monthly_cap_micros=10000000");
  for (const p of ["CLAUDE", "GEMINI", "GROK", "META"])
    Object.assign(env, {
      [`${p}_API_KEY`]: "fixture-not-real",
      [`${p}_MODEL`]: "fixture-model",
      [`${p}_TERMS_APPROVED`]: "true",
      [`${p}_INPUT_USD_PER_MILLION`]: "1",
      [`${p}_OUTPUT_USD_PER_MILLION`]: "2",
      [`${p}_SEARCH_USD_PER_CALL`]: ".01",
      [`${p}_MAX_EXECUTION_USD`]: ".1",
    });
  env.GEMINI_SEARCH_RESERVE_CALLS = "3";
  const providers = [
    "openai",
    "perplexity",
    "claude",
    "gemini",
    "grok",
    "meta",
  ];
  let studyId,
    promptId,
    baseline = [],
    followup = [],
    changeId;
  const p = (action) =>
    `brands/${brands[0]}/studies${studyId ? `/${studyId}` : ""}${action ? `/${action}` : ""}`;
  const runner = async (provider, p) => {
    assert.equal(p.executionConfig.model, "fixture-model");
    assert.equal(p.text, "Frozen baseline question");
    return {
      model: "fixture-model",
      text: "Brand0 is useful.",
      citations: [{ url: "https://brand0.example/", title: "Brand0" }],
      searched: true,
      usage: { input_tokens: 20, output_tokens: 40 },
      costMicros: 10000,
      costKind: "provider_reported",
      request: { model: "fixture-model", tools: [{ type: "web_search" }] },
      raw: {
        fixture: true,
        text: "Brand0 is useful.",
        citations: ["https://brand0.example/"],
      },
      providerMetadata:
        provider === "gemini"
          ? {
              searchSuggestions:
                '<div>Google Search Suggestions <a href="https://www.google.com/search?q=Brand0">Search</a><script>window.parent.bad=true</script></div>',
            }
          : null,
    };
  };
  async function drain() {
    for (let i = 0; i < 6; i++) {
      await pool.query("TRUNCATE visibility.provider_throttle");
      assert.equal(await processOne(pool, { env, runner }), true);
    }
  }
  await t.test(
    "Phase 2 freezes prompts, brand configuration and thresholds without keys",
    async () => {
      const prompt = await call(`brands/${brands[0]}/prompts`, {
        method: "POST",
        body: {
          text: "Frozen baseline question",
          providers,
          language: "en",
          region: "US",
        },
      });
      assert.equal(prompt.status, 201);
      promptId = prompt.data.ids[0];
      const r = await call(`brands/${brands[0]}/studies`, {
        method: "POST",
        body: {
          name: "Six-provider internal validation",
          promptIds: [promptId],
          thresholds: {
            minCompletedPerStage: 1,
            minReviewedPerProvider: 1,
            minPrecision: 0.95,
            minRecall: 0.95,
            maxFailureRate: 0.1,
            maxUncertainRate: 0.1,
            maxCostPer1000Usd: 20,
          },
        },
      });
      assert.equal(r.status, 201);
      studyId = r.data.id;
      assert.equal(Object.keys(r.data.data.configurations).length, 6);
      assert.ok(!JSON.stringify(r.data).includes("fixture-not-real"));
      assert.ok(r.data.data.manifestFingerprint);
      assert.equal(
        (await call(`brands/${brands[1]}/studies/${studyId}`, { who: 1 }))
          .status,
        404,
      );
      assert.equal(
        (
          await call(p("batches"), {
            method: "POST",
            body: { stage: "followup" },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call(p("decision"), {
            method: "POST",
            body: {
              outcome: "approve_beta",
              notes: "Premature approval rejected",
            },
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "controlled baseline batches deduplicate and preserve frozen inputs",
    async () => {
      const args = {
        method: "POST",
        headers: { "Idempotency-Key": "phase2-baseline-once" },
        body: { stage: "baseline", repetitions: 1 },
      };
      const a = await call(p("batches"), args),
        b = await call(p("batches"), args);
      assert.equal(a.status, 202);
      assert.equal(a.data.id, b.data.id);
      assert.equal(a.data.planned, 6);
      assert.equal(
        (
          await call(`brands/${brands[0]}/prompts/${promptId}`, {
            method: "PUT",
            body: { text: "Edited current question", region: "GB" },
          })
        ).status,
        200,
      );
      await drain();
      baseline = (
        await pool.query(
          "SELECT * FROM visibility.executions WHERE tenant_id=$1 AND data->>'studyId'=$2 ORDER BY data->>'provider'",
          [tenants[0], studyId],
        )
      ).rows;
      assert.equal(baseline.length, 6);
      assert.ok(
        baseline.every(
          (r) =>
            r.data.prompt === "Frozen baseline question" &&
            r.data.region === "US" &&
            r.data.promptVersion === 1,
        ),
      );
    },
  );
  await t.test(
    "followup requires post-baseline deployed-change evidence and uses frozen models",
    async () => {
      const audits = (await call(`brands/${brands[0]}/report`)).data.audits;
      assert.ok(audits.length);
      const r = await call(`brands/${brands[0]}/changes`, {
        method: "POST",
        body: {
          description: "Phase 2 title improvement",
          findingId: `${audits[0].id}:0`,
          link: "https://github.com/example/repo/pull/2",
          deployedAt: new Date().toISOString(),
        },
      });
      assert.equal(r.status, 201);
      changeId = (await call(`brands/${brands[0]}/report`)).data.changes.at(
        -1,
      ).id;
      assert.equal(
        (
          await call(p("batches"), {
            method: "POST",
            body: { stage: "followup", changeIds: [randomUUID()] },
          })
        ).status,
        400,
      );
      env.OPENAI_MODEL = "edited-model";
      const batch = await call(p("batches"), {
        method: "POST",
        body: { stage: "followup", repetitions: 1, changeIds: [changeId] },
      });
      assert.equal(batch.status, 202);
      await drain();
      env.OPENAI_MODEL = "fixture-model";
      followup = (
        await pool.query(
          "SELECT * FROM visibility.executions WHERE tenant_id=$1 AND data->>'studyId'=$2 AND data->>'studyStage'='followup' ORDER BY data->>'provider'",
          [tenants[0], studyId],
        )
      ).rows;
      assert.equal(followup.length, 6);
      assert.ok(
        followup.every((r) => r.data.executionConfig.model === "fixture-model"),
      );
      assert.equal(
        (
          await call(p("batches"), {
            method: "POST",
            body: { stage: "baseline" },
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "reviews require raw evidence inspection and preserve corrections with false-positive/negative counts",
    async () => {
      const r = baseline[0],
        path = p(`reviews/${r.id}`);
      const body = {
        citationUrls: ["https://brand0.example/"],
        mentionDomains: ["brand0.example"],
        notes: "Reviewed independent raw response",
        reviewedRaw: true,
      };
      assert.equal((await call(path, { method: "POST", body })).status, 400);
      await call(`brands/${brands[0]}/evidence/${r.id}`);
      const bad = await call(path, {
        method: "POST",
        body: {
          ...body,
          citationUrls: ["https://missed.example/"],
          mentionDomains: [],
        },
      });
      assert.equal(bad.status, 201);
      assert.equal(bad.data.result.citations.fp, 1);
      assert.equal(bad.data.result.citations.fn, 1);
      assert.equal(bad.data.result.mentions.fp, 1);
      for (const row of [...baseline, ...followup]) {
        await call(`brands/${brands[0]}/evidence/${row.id}`);
        assert.equal(
          (await call(p(`reviews/${row.id}`), { method: "POST", body })).status,
          201,
        );
      }
      const report = await call(p(""));
      assert.equal(report.status, 200);
      assert.equal(report.data.quality.reviewed, 12);
      assert.equal(report.data.reviews.length, 13);
      assert.ok(
        report.data.providers.every(
          (p) => p.citations.precision === 1 && p.mentions.recall === 1,
        ),
      );
      assert.equal(report.data.matchedComparisons.length, 6);
      assert.ok(
        report.data.matchedComparisons.every(
          (p) => p.baseline.eligible === 1 && p.followup.eligible === 1,
        ),
      );
      assert.equal(report.data.gate.ready, false);
      assert.equal(
        (
          await call(`brands/${brands[1]}/studies/${studyId}/reviews/${r.id}`, {
            who: 1,
            method: "POST",
            body,
          })
        ).status,
        404,
      );
    },
  );
  await t.test(
    "provider dispositions require grounded evidence matching current configuration",
    async () => {
      for (const provider of providers) {
        const row = baseline.find((r) => r.data.provider === provider);
        const args = {
          method: "POST",
          body: {
            provider,
            status: "validated",
            notes: "Confirmed permitted API and reviewed grounded response",
            evidenceExecutionIds: [row.id],
          },
        };
        assert.equal((await call("provider-checks", args)).status, 201);
      }
      const own = baseline.find((r) => r.data.provider === "meta");
      assert.equal(
        (
          await call("provider-checks", {
            who: 1,
            method: "POST",
            body: {
              provider: "meta",
              status: "validated",
              notes: "Foreign evidence is rejected",
              evidenceExecutionIds: [own.id],
            },
          })
        ).status,
        400,
      );
      env.META_MODEL = "changed-model";
      assert.equal(
        (await call(p(""))).data.dispositions.find((p) => p.provider === "meta")
          .status,
        "stale",
      );
      env.META_MODEL = "fixture-model";
    },
  );
  await t.test(
    "verification and incident evidence gates are explicit; actual billing can be reconciled",
    async () => {
      assert.equal(
        (
          await call(p("recommendations"), {
            method: "POST",
            body: {
              changeId,
              verdict: "verified",
              evidenceUrl: "https://github.com/example/repo/pull/2",
              notes:
                "Developer confirmed title is deployed and audit finding resolved",
            },
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await call(p("incidents"), {
            method: "POST",
            body: {
              type: "drill",
              status: "open",
              scenario: "Provider outage recovery",
              evidenceUrl: "https://example.com/internal/drill",
              notes: "Open drill, not yet verified",
            },
          })
        ).status,
        201,
      );
      let report = (await call(p(""))).data;
      assert.equal(report.gate.ready, false);
      const incident = report.validations.find((v) => v.kind === "incident");
      assert.equal(
        (
          await call(p("incidents"), {
            method: "POST",
            body: {
              incidentId: incident.id,
              type: "drill",
              status: "resolved",
              scenario: "Provider outage recovery",
              evidenceUrl: "https://example.com/internal/drill",
              notes:
                "Verified uncertain request stays reserved and is not replayed",
            },
          })
        ).status,
        201,
      );
      report = (await call(p(""))).data;
      assert.equal(report.gate.ready, true, JSON.stringify(report.gate.checks));
      assert.equal(report.cost.per1000Usd, 10);
      assert.equal(report.cost.per1000AttemptsUsd, 10);
      assert.equal(report.cost.per1000SuccessfulExecutionsUsd, 10);
      const usage = (
        await pool.query(
          "SELECT u.* FROM visibility.usage u JOIN visibility.jobs j ON j.tenant_id=u.tenant_id AND j.id=u.job_id WHERE u.tenant_id=$1 AND j.study_id=$2 LIMIT 1",
          [tenants[0], studyId],
        )
      ).rows[0];
      await pool.query(
        "UPDATE visibility.usage SET actual_micros=NULL,state='unknown' WHERE tenant_id=$1 AND id=$2",
        [tenants[0], usage.id],
      );
      assert.equal((await call(p(""))).data.gate.ready, false);
      assert.equal(
        (
          await call(`usage/${usage.id}/reconcile`, {
            method: "POST",
            body: {
              actualUsd: 0.01,
              evidenceUrl: "https://example.com/internal/invoice",
              notes: "Reconciled actual provider invoice charge",
            },
          })
        ).status,
        200,
      );
      assert.equal((await call(p(""))).data.gate.ready, true);
      assert.equal(
        (
          await call(`usage/${usage.id}/reconcile`, {
            who: 1,
            method: "POST",
            body: {
              actualUsd: 0,
              evidenceUrl: "https://example.com/invoice",
              notes: "No cross tenant access",
            },
          })
        ).status,
        404,
      );
    },
  );
  await t.test(
    "owner gate decision records an evidence snapshot and becomes stale after new evidence",
    async () => {
      await pool.query(
        "UPDATE visibility.memberships SET role='ADMIN' WHERE tenant_id=$1 AND user_id=$2",
        [tenants[0], users[0]],
      );
      assert.equal(
        (
          await call(p("decision"), {
            method: "POST",
            body: {
              outcome: "approve_beta",
              notes: "Admin cannot approve the gate",
            },
          })
        ).status,
        403,
      );
      await pool.query(
        "UPDATE visibility.memberships SET role='OWNER' WHERE tenant_id=$1 AND user_id=$2",
        [tenants[0], users[0]],
      );
      const decision = await call(p("decision"), {
        method: "POST",
        body: {
          outcome: "approve_beta",
          notes:
            "Synthetic fixture-only approval exercises owner gate; not a real release",
        },
      });
      assert.equal(decision.status, 201);
      let report = (await call(p(""))).data;
      assert.equal(report.gate.decisionSnapshotCurrent, true);
      env.META_TERMS_APPROVED = "false";
      const revoked = (await call(p(""))).data;
      assert.equal(revoked.gate.ready, false);
      assert.equal(revoked.gate.decisionSnapshotCurrent, false);
      env.META_TERMS_APPROVED = "true";
      assert.equal((await call(p(""))).data.gate.decisionSnapshotCurrent, true);

      assert.equal(
        (
          await call(p("incidents"), {
            method: "POST",
            body: {
              type: "drill",
              status: "open",
              scenario: "New schema-change drill",
              evidenceUrl: "https://example.com/drill/2",
              notes: "New evidence after decision invalidates current gate",
            },
          })
        ).status,
        201,
      );
      report = (await call(p(""))).data;
      assert.equal(report.gate.decisionSnapshotCurrent, false);
      assert.equal(report.gate.ready, false);
      const exported = await call(p("report.csv"));
      assert.equal(exported.status, 200);
      assert.match(exported.data, /Frozen|frozen/);
      assert.ok(!exported.data.includes("fixture-not-real"));
      assert.ok(!exported.data.includes("ciphertext"));
    },
  );
  await t.test(
    "Google suggestions are tenant-bound isolated HTML, not executable parent markup",
    async () => {
      const row = baseline.find((r) => r.data.provider === "gemini");
      const route = `search-suggestions?tenant=${tenants[0]}&brand=${brands[0]}&execution=${row.id}`;
      const r = await call(route);
      assert.equal(r.status, 200);
      assert.match(
        r.headers.get("content-security-policy"),
        /script-src 'none'/,
      );
      assert.match(r.headers.get("content-security-policy"), /sandbox/);
      assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.equal((await call(route, { who: 1 })).status, 403);
    },
  );
  await t.test(
    "blocked provider dispositions stop paid dispatch and pending explicitly reopens testing",
    async () => {
      assert.equal(
        (
          await call("provider-checks", {
            method: "POST",
            body: {
              provider: "claude",
              status: "blocked",
              notes: "Access validation blocked during test drill",
              evidenceExecutionIds: [],
            },
          })
        ).status,
        201,
      );
      const job = await transaction(pool, (c) =>
        enqueue(c, tenants[0], brands[0], "monitor", {
          provider: "claude",
          text: "test blocked",
          region: "US",
          language: "en",
          brand: { name: "Brand0", domain: "brand0.example" },
        }),
      );
      let called = false;
      await processOne(pool, {
        env,
        runner: async () => {
          called = true;
        },
      });
      assert.equal(called, false);
      const saved = (
        await pool.query(
          "SELECT status FROM visibility.jobs WHERE tenant_id=$1 AND id=$2",
          [tenants[0], job.id],
        )
      ).rows[0];
      assert.equal(saved.status, "failed");
      assert.equal(
        (await call("state")).data.providers.find((p) => p.id === "claude")
          .ready,
        false,
      );
      assert.equal(
        (
          await call("provider-checks", {
            method: "POST",
            body: {
              provider: "claude",
              status: "pending",
              notes: "Access restored; explicitly reopen validation",
              evidenceExecutionIds: [],
            },
          })
        ).status,
        201,
      );
      assert.equal(
        (await call("state")).data.providers.find((p) => p.id === "claude")
          .ready,
        true,
      );
    },
  );
  await t.test(
    "Phase 2 browser freezes studies, corrects human labels and shows gate status",
    { skip: process.env.VISIBILITY_BROWSER_TESTS !== "true" },
    () =>
      phase2Browser({
        base,
        password,
        brandId: brands[0],
        studyId,
        promptId,
        tenants,
        baseline,
      }),
  );
}
