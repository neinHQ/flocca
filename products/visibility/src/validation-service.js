import { randomUUID } from "node:crypto";
import { transaction, enqueue, event } from "./db.js";
import {
  catalog,
  coverage,
  snapshot,
  fingerprint,
  normalizedUrl,
} from "./providers.js";
import { thresholds, reviewResult, studyReport } from "./quality.js";
import { text, uuid, domain } from "./validation.js";
import { unseal } from "./secrets.js";
import { csv } from "./metrics.js";
const error = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const requireValue = (condition, message, status = 400) => {
  if (!condition) throw error(message, status);
};
function evidenceLink(value) {
  const url = normalizedUrl(value);
  if (!url) throw error("A valid evidence URL is required");
  return url;
}
async function execution(c, tenant, brand, id) {
  requireValue(uuid(id), "Invalid execution ID");
  const row = (
    await c.query(
      "SELECT * FROM visibility.executions WHERE tenant_id=$1 AND brand_id=$2 AND id=$3",
      [tenant, brand, id],
    )
  ).rows[0];
  requireValue(row, "Execution not found", 404);
  return row;
}
async function study(c, tenant, brand, id, lock = false) {
  requireValue(uuid(id), "Invalid study ID");
  const row = (
    await c.query(
      `SELECT * FROM visibility.studies WHERE tenant_id=$1 AND brand_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`,
      [tenant, brand, id],
    )
  ).rows[0];
  requireValue(row, "Study not found", 404);
  return row;
}
export async function reportFor(c, tenant, s, env) {
  const queries = [];
  const query = (...args) => {
    queries.push(args);
  };
  [
    query(
      "SELECT * FROM visibility.batches WHERE tenant_id=$1 AND study_id=$2 ORDER BY created_at",
      [tenant, s.id],
    ),
    query(
      "SELECT * FROM visibility.jobs WHERE tenant_id=$1 AND study_id=$2 ORDER BY created_at,id",
      [tenant, s.id],
    ),
    query(
      "SELECT e.* FROM visibility.executions e JOIN visibility.jobs j ON j.tenant_id=e.tenant_id AND j.id=e.job_id WHERE e.tenant_id=$1 AND j.study_id=$2 ORDER BY e.observed_at,e.id",
      [tenant, s.id],
    ),
    query(
      "SELECT r.* FROM visibility.reviews r JOIN visibility.executions e ON e.tenant_id=r.tenant_id AND e.id=r.execution_id JOIN visibility.jobs j ON j.tenant_id=e.tenant_id AND j.id=e.job_id WHERE r.tenant_id=$1 AND j.study_id=$2 ORDER BY r.created_at,r.id",
      [tenant, s.id],
    ),
    query(
      "SELECT u.* FROM visibility.usage u JOIN visibility.jobs j ON j.tenant_id=u.tenant_id AND j.id=u.job_id WHERE u.tenant_id=$1 AND j.study_id=$2 ORDER BY u.created_at,u.id",
      [tenant, s.id],
    ),
    query(
      "SELECT * FROM visibility.validations WHERE tenant_id=$1 AND study_id=$2 ORDER BY created_at,id",
      [tenant, s.id],
    ),
    query(
      "SELECT * FROM visibility.provider_checks WHERE tenant_id=$1 ORDER BY created_at,id",
      [tenant],
    ),
  ];
  const results = [];
  for (const args of queries) results.push(await c.query(...args));
  const [batches, jobs, runs, reviews, usage, validations, checks] = results;
  const safeRuns = runs.rows.map((r) => ({
    ...r,
    data: { ...r.data, raw: undefined },
  }));
  const result = studyReport({
    study: s,
    batches: batches.rows,
    jobs: jobs.rows,
    runs: safeRuns,
    reviews: reviews.rows,
    usage: usage.rows,
    validations: validations.rows,
    providerChecks: checks.rows,
    catalog,
    readyProviders: coverage(env)
      .filter((p) => p.ready)
      .map((p) => p.id),
    envFingerprints: Object.fromEntries(
      catalog.map((p) => [p.id, fingerprint(snapshot(p.id, env))]),
    ),
  });
  return result;
}
export async function tenantValidationRoute(
  pool,
  { tenant, user, member, path, body, method, send, env },
) {
  if (path === "/api/provider-checks" && method === "POST") {
    const provider = body.provider;
    requireValue(
      catalog.some((p) => p.id === provider),
      "Unknown provider",
    );
    requireValue(
      ["validated", "blocked", "pending"].includes(body.status),
      "Choose validated, blocked or pending",
    );
    const notes = text(body.notes, "notes", 4000),
      ids = body.evidenceExecutionIds || [];
    requireValue(
      Array.isArray(ids) && ids.length <= 20 && ids.every(uuid),
      "Invalid evidence execution IDs",
    );
    const data = {
      status: body.status,
      notes,
      evidenceExecutionIds: ids,
      configurationFingerprint: fingerprint(snapshot(provider, env)),
    };
    await transaction(pool, async (c) => {
      if (body.status === "validated") {
        requireValue(
          coverage(env).find((p) => p.id === provider)?.ready,
          "Provider is not configured",
          409,
        );
        requireValue(
          ids.length > 0,
          "Successful grounded execution evidence is required",
        );
        const rows = (
          await c.query(
            "SELECT id,data FROM visibility.executions WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
            [tenant, ids],
          )
        ).rows;
        requireValue(
          rows.length === new Set(ids).size &&
            rows.every(
              (r) =>
                r.data.provider === provider &&
                r.data.status === "completed" &&
                r.data.searched &&
                r.data.configurationFingerprint ===
                  data.configurationFingerprint,
            ),
          "Evidence must be successful grounded executions matching the current provider configuration",
        );
      }
      await c.query(
        "INSERT INTO visibility.provider_checks(tenant_id,id,provider,data) VALUES($1,$2,$3,$4)",
        [tenant, randomUUID(), provider, data],
      );
      await event(c, tenant, user.id, "provider.disposition_recorded", {
        provider,
        ...data,
      });
    });
    send(201, { ok: true });
    return true;
  }
  const reconcile = path.match(/^\/api\/usage\/([^/]+)\/reconcile$/);
  if (reconcile && method === "POST") {
    requireValue(member.role === "OWNER", "Owner access required", 403);
    requireValue(uuid(reconcile[1]), "Invalid usage ID");
    const micros = Math.round(body.actualUsd * 1e6);
    requireValue(
      typeof body.actualUsd === "number" &&
        Number.isSafeInteger(micros) &&
        micros >= 0,
      "actualUsd must be a nonnegative amount",
    );
    const data = {
      actualMicros: micros,
      evidenceUrl: evidenceLink(body.evidenceUrl),
      notes: text(body.notes, "notes", 4000),
    };
    await transaction(pool, async (c) => {
      const old = (
        await c.query(
          "SELECT * FROM visibility.usage WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, reconcile[1]],
        )
      ).rows[0];
      requireValue(old, "Usage not found", 404);
      await c.query(
        "INSERT INTO visibility.reconciliations(tenant_id,id,usage_id,actor_id,data) VALUES($1,$2,$3,$4,$5)",
        [
          tenant,
          randomUUID(),
          old.id,
          user.id,
          {
            ...data,
            previous: { actualMicros: old.actual_micros, state: old.state },
          },
        ],
      );
      await c.query(
        "UPDATE visibility.usage SET actual_micros=$3,state='reconciled' WHERE tenant_id=$1 AND id=$2",
        [tenant, old.id, micros],
      );
      await event(c, tenant, user.id, "usage.reconciled", {
        usageId: old.id,
        ...data,
      });
    });
    send(200, { ok: true });
    return true;
  }
  return false;
}
export async function validationRoute(
  pool,
  { tenant, user, member, brand, action, body, method, send, env, key },
) {
  if (action === "studies" && method === "GET")
    return send(200, {
      studies: (
        await pool.query(
          "SELECT * FROM visibility.studies WHERE tenant_id=$1 AND brand_id=$2 ORDER BY created_at DESC",
          [tenant, brand.id],
        )
      ).rows,
    });
  if (action === "studies" && method === "POST") {
    const name = text(body.name, "name", 150),
      t = thresholds(body.thresholds),
      ids = body.promptIds;
    requireValue(
      Array.isArray(ids) &&
        ids.length > 0 &&
        ids.length <= 100 &&
        ids.every(uuid),
      "Select 1–100 prompt IDs",
    );
    const id = randomUUID();
    const data = await transaction(pool, async (c) => {
      const prompts = (
        await c.query(
          "SELECT * FROM visibility.prompts WHERE tenant_id=$1 AND brand_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR SHARE",
          [tenant, brand.id, ids],
        )
      ).rows;
      requireValue(
        prompts.length === new Set(ids).size,
        "One or more prompts were not found",
        404,
      );
      const providers = [...new Set(prompts.flatMap((p) => p.data.providers))];
      requireValue(
        providers.every((id) => coverage(env).find((p) => p.id === id)?.ready),
        "Every selected provider must be configured",
        409,
      );
      const data = {
        name,
        thresholds: t,
        brand: brand.data,
        prompts: prompts.map((p) => ({
          id: p.id,
          version: p.version,
          ...p.data,
        })),
        configurations: Object.fromEntries(
          providers.map((id) => [id, snapshot(id, env)]),
        ),
        sampling:
          "Manual batches with fixed repetitions per frozen prompt/provider; no historic backfill",
      };
      data.manifestFingerprint = fingerprint(data);
      await c.query(
        "INSERT INTO visibility.studies(tenant_id,id,brand_id,data) VALUES($1,$2,$3,$4)",
        [tenant, id, brand.id, data],
      );
      await event(c, tenant, user.id, "study.frozen", {
        id,
        name,
        manifestFingerprint: data.manifestFingerprint,
      });
      return data;
    });
    return send(201, { id, data });
  }
  const match = action.match(/^studies\/([^/]+)(?:\/(.*))?$/);
  requireValue(match, "Not found", 404);
  const id = match[1],
    route = match[2] || "",
    s = await study(pool, tenant, brand.id, id);
  if ((!route || route === "report.csv") && method === "GET") {
    const report = await transaction(pool, (c) => reportFor(c, tenant, s, env));
    if (route === "report.csv") {
      send(
        200,
        csv([
          {
            type: "methodology",
            value: report.methodology,
            manifest: s.data.manifestFingerprint,
          },
          ...report.providers.map((p) => ({ type: "provider_quality", ...p })),
          { type: "cost", ...report.cost },
          { type: "reliability", ...report.reliability },
          ...report.gate.checks.map((c) => ({ type: "gate", ...c })),
          ...report.dispositions.map((d) => ({ type: "disposition", ...d })),
          ...report.validations.map((v) => ({
            type: v.kind,
            at: v.created_at,
            data: v.data,
          })),
          ...report.reviews.map((r) => ({
            type: "review",
            execution: r.execution_id,
            at: r.created_at,
            data: r.data,
          })),
        ]),
        "text/csv",
      );
      return;
    }
    return send(200, report);
  }
  if (route === "batches" && method === "POST") {
    requireValue(
      ["baseline", "followup"].includes(body.stage),
      "Choose baseline or followup",
    );
    const count = body.repetitions ?? 1;
    requireValue(
      Number.isInteger(count) && count >= 1 && count <= 20,
      "Repetitions must be 1–20",
    );
    requireValue(
      typeof key === "string" && key.length <= 100,
      "Idempotency key is required",
    );
    const result = await transaction(pool, async (c) => {
      const s = await study(c, tenant, brand.id, id, true);
      const existing = (
        await c.query(
          "SELECT * FROM visibility.batches WHERE tenant_id=$1 AND study_id=$2 AND data->>'requestKey'=$3",
          [tenant, id, key],
        )
      ).rows[0];
      if (existing) return { id: existing.id, reused: true };
      requireValue(
        s.data.prompts.reduce((n, p) => n + p.providers.length, 0) * count <=
          500,
        "A batch may contain at most 500 jobs",
      );
      requireValue(
        Object.keys(s.data.configurations).every(
          (p) => coverage(env).find((x) => x.id === p)?.ready,
        ),
        "Provider access is currently unavailable",
        409,
      );
      const batches = (
        await c.query(
          "SELECT * FROM visibility.batches WHERE tenant_id=$1 AND study_id=$2",
          [tenant, id],
        )
      ).rows;
      const changeIds = body.changeIds || [];
      requireValue(
        Array.isArray(changeIds) &&
          changeIds.length <= 30 &&
          changeIds.every(uuid),
        "Invalid change IDs",
      );
      if (body.stage === "baseline")
        requireValue(
          !batches.some((b) => b.stage === "followup"),
          "Baseline is closed after follow-up begins",
          409,
        );
      else {
        requireValue(
          batches.some((b) => b.stage === "baseline"),
          "Capture a baseline first",
          409,
        );
        const jobs = (
          await c.query(
            "SELECT * FROM visibility.jobs WHERE tenant_id=$1 AND study_id=$2 AND payload->>'studyStage'='baseline'",
            [tenant, id],
          )
        ).rows;
        requireValue(
          jobs.length > 0 &&
            jobs.every((j) => !["queued", "running"].includes(j.status)),
          "Wait until all baseline jobs finish",
          409,
        );
        const baseline = (
          await c.query(
            "SELECT max(e.observed_at) AS last,count(*)::integer AS count FROM visibility.executions e JOIN visibility.jobs j ON j.tenant_id=e.tenant_id AND j.id=e.job_id WHERE e.tenant_id=$1 AND j.study_id=$2 AND e.data->>'studyStage'='baseline' AND e.data->>'status'='completed' AND (e.data->>'searched')::boolean",
            [tenant, id],
          )
        ).rows[0];
        requireValue(
          baseline.count > 0 && changeIds.length > 0,
          "A grounded baseline and deployed change evidence are required",
          409,
        );
        const changes = (
          await c.query(
            "SELECT * FROM visibility.changes WHERE tenant_id=$1 AND brand_id=$2 AND id=ANY($3::uuid[])",
            [tenant, brand.id, changeIds],
          )
        ).rows;
        requireValue(
          changes.length === new Set(changeIds).size &&
            changes.every(
              (c) => Date.parse(c.data.deployedAt) > Date.parse(baseline.last),
            ),
          "Selected changes must belong to this brand and be deployed after the baseline",
        );
      }
      const batch = randomUUID();
      await c.query(
        "INSERT INTO visibility.batches(tenant_id,id,study_id,stage,data) VALUES($1,$2,$3,$4,$5)",
        [
          tenant,
          batch,
          id,
          body.stage,
          { repetitions: count, changeIds, requestKey: key },
        ],
      );
      let planned = 0;
      for (let repetition = 0; repetition < count; repetition++)
        for (const p of s.data.prompts)
          for (const provider of p.providers) {
            await enqueue(
              c,
              tenant,
              brand.id,
              "monitor",
              {
                ...p,
                promptId: p.id,
                promptVersion: p.version,
                provider,
                brand: s.data.brand,
                executionConfig: s.data.configurations[provider],
                studyStage: body.stage,
              },
              `study:${batch}:${p.id}:${provider}:${repetition}`,
              { studyId: id, batchId: batch },
            );
            planned++;
          }
      await event(c, tenant, user.id, "study.batch_queued", {
        studyId: id,
        batchId: batch,
        stage: body.stage,
        planned,
      });
      return { id: batch, planned };
    });
    return send(202, result);
  }
  const review = route.match(/^reviews\/([^/]+)$/);
  if (review && method === "POST") {
    const r = await execution(pool, tenant, brand.id, review[1]);
    requireValue(
      r.data.studyId === id && r.data.status === "completed",
      "Execution must be a completed answer from this study",
    );
    requireValue(
      body.reviewedRaw === true,
      "Inspect raw response evidence before labeling",
    );
    requireValue(
      (
        await pool.query(
          "SELECT 1 FROM visibility.events WHERE tenant_id=$1 AND actor_id=$2 AND action='evidence.read' AND data->>'id'=$3 LIMIT 1",
          [tenant, user.id, r.id],
        )
      ).rowCount,
      "Open the raw evidence for this execution before reviewing",
    );
    const urls = body.citationUrls,
      domains = body.mentionDomains;
    requireValue(
      Array.isArray(urls) &&
        urls.length <= 100 &&
        urls.every((u) => !!normalizedUrl(u)),
      "Provide expected citation URLs",
    );
    requireValue(
      Array.isArray(domains) && domains.length <= 21,
      "Provide expected mention domains",
    );
    const allowed = [
      s.data.brand.domain,
      ...s.data.brand.competitors.map((c) => c.domain),
    ];
    const mentionDomains = [...new Set(domains.map(domain))];
    requireValue(
      mentionDomains.every((d) => allowed.includes(d)),
      "Mention labels must use tracked brand/competitor domains",
    );
    const expected = {
      citationUrls: [...new Set(urls.map(normalizedUrl))],
      mentionDomains,
    };
    const data = {
      expected,
      result: reviewResult(r.data, expected),
      notes: text(body.notes, "notes", 4000),
      reviewedRaw: true,
      extractionVersion: r.data.extractionVersion,
      predictionFingerprint: fingerprint({
        citations: r.data.citations,
        mentions: r.data.mentions,
      }),
    };
    await transaction(pool, async (c) => {
      await c.query(
        "INSERT INTO visibility.reviews(tenant_id,id,execution_id,reviewer_id,data) VALUES($1,$2,$3,$4,$5)",
        [tenant, randomUUID(), r.id, user.id, data],
      );
      await event(c, tenant, user.id, "extraction.reviewed", {
        studyId: id,
        executionId: r.id,
        result: data.result,
      });
    });
    return send(201, data);
  }
  if (route === "recommendations" && method === "POST") {
    requireValue(
      ["verified", "actionable", "not_useful"].includes(body.verdict),
      "Invalid verdict",
    );
    requireValue(uuid(body.changeId), "A deployed change ID is required");
    const change = (
      await pool.query(
        "SELECT * FROM visibility.changes WHERE tenant_id=$1 AND brand_id=$2 AND id=$3",
        [tenant, brand.id, body.changeId],
      )
    ).rows[0];
    requireValue(change, "Change not found", 404);
    const data = {
      changeId: change.id,
      findingId: change.data.findingId,
      verdict: body.verdict,
      evidenceUrl: evidenceLink(body.evidenceUrl),
      notes: text(body.notes, "notes", 4000),
    };
    await transaction(pool, async (c) => {
      await c.query(
        "INSERT INTO visibility.validations(tenant_id,id,study_id,kind,data) VALUES($1,$2,$3,'recommendation',$4)",
        [tenant, randomUUID(), id, data],
      );
      await event(c, tenant, user.id, "recommendation.reviewed", {
        studyId: id,
        ...data,
      });
    });
    return send(201, { ok: true });
  }
  if (route === "incidents" && method === "POST") {
    requireValue(
      ["drill", "production"].includes(body.type) &&
        ["open", "resolved"].includes(body.status),
      "Choose incident type and status",
    );
    const data = {
      type: body.type,
      status: body.status,
      scenario: text(body.scenario, "scenario", 150),
      notes: text(body.notes, "notes", 4000),
      evidenceUrl: evidenceLink(body.evidenceUrl),
    };
    await transaction(pool, async (c) => {
      if (body.incidentId) {
        requireValue(uuid(body.incidentId), "Invalid incident ID");
        const old = (
          await c.query(
            "SELECT * FROM visibility.validations WHERE tenant_id=$1 AND study_id=$2 AND id=$3 AND kind='incident' FOR UPDATE",
            [tenant, id, body.incidentId],
          )
        ).rows[0];
        requireValue(old, "Incident not found", 404);
        await c.query(
          "UPDATE visibility.validations SET data=$4 WHERE tenant_id=$1 AND study_id=$2 AND id=$3",
          [tenant, id, old.id, data],
        );
      } else
        await c.query(
          "INSERT INTO visibility.validations(tenant_id,id,study_id,kind,data) VALUES($1,$2,$3,'incident',$4)",
          [tenant, randomUUID(), id, data],
        );
      await event(c, tenant, user.id, "incident.recorded", {
        studyId: id,
        incidentId: body.incidentId || null,
        ...data,
      });
    });
    return send(201, { ok: true });
  }
  if (route === "decision" && method === "POST") {
    requireValue(
      member.role === "OWNER",
      "Only an owner can record a phase gate decision",
      403,
    );
    requireValue(
      ["approve_beta", "hold"].includes(body.outcome),
      "Choose approve_beta or hold",
    );
    const result = await transaction(pool, async (c) => {
      await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await study(c, tenant, brand.id, id, true);
      const report = await reportFor(c, tenant, s, env);
      requireValue(
        body.outcome !== "approve_beta" || report.gate.ready,
        "Phase 2 evidence checks have not passed",
        409,
      );
      const data = {
        outcome: body.outcome,
        notes: text(body.notes, "notes", 4000),
        evidenceFingerprint: report.evidenceFingerprint,
        checks: report.gate.checks,
        approvedBy: user.id,
      };
      await c.query(
        "INSERT INTO visibility.validations(tenant_id,id,study_id,kind,data) VALUES($1,$2,$3,'decision',$4)",
        [tenant, randomUUID(), id, data],
      );
      await event(c, tenant, user.id, "phase2.decision", {
        studyId: id,
        ...data,
      });
      return data;
    });
    return send(201, result);
  }
  throw error("Not found", 404);
}
