import { randomUUID } from "node:crypto";
import { database, transaction, enqueue, event, reserve } from "./db.js";
import {
  coverage,
  config,
  execute,
  executionConfig,
  snapshot,
  fingerprint,
  ADAPTER_VERSION,
} from "./providers.js";
import { mentions } from "./metrics.js";
import { audit } from "./crawler.js";
import { seal } from "./secrets.js";
export async function schedule(pool) {
  return transaction(pool, async (c) => {
    const due = (
      await c.query(`SELECT p.*,b.data AS brand FROM visibility.prompts p JOIN visibility.brands b ON b.tenant_id=p.tenant_id AND b.id=p.brand_id
      WHERE p.active AND p.interval_minutes IS NOT NULL AND p.next_run_at<=now() ORDER BY p.next_run_at LIMIT 100 FOR UPDATE OF p SKIP LOCKED`)
    ).rows;
    for (const p of due) {
      for (const provider of p.data.providers)
        await enqueue(
          c,
          p.tenant_id,
          p.brand_id,
          "monitor",
          {
            ...p.data,
            promptId: p.id,
            promptVersion: p.version,
            provider,
            brand: p.brand,
          },
          `schedule:${p.id}:${p.version}:${new Date(p.next_run_at).toISOString()}:${provider}`,
        );
      // Missed intervals collapse to one observation; no invented historical backfill.
      await c.query(
        "UPDATE visibility.prompts SET next_run_at=now()+interval '1 minute'*interval_minutes WHERE tenant_id=$1 AND id=$2",
        [p.tenant_id, p.id],
      );
    }
    return due.length;
  });
}
export async function recover(pool) {
  await transaction(pool, async (c) => {
    if (
      !(await c.query("SELECT pg_try_advisory_xact_lock(782411) AS ok")).rows[0]
        .ok
    )
      return;
    const stale = (
      await c.query(
        "SELECT * FROM visibility.jobs WHERE status='running' AND started_at<now()-interval '10 minutes' FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const job of stale) {
      const status =
        job.kind === "monitor"
          ? "uncertain"
          : job.attempts < 3
            ? "queued"
            : "failed";
      await c.query(
        "UPDATE visibility.jobs SET status=$3,error=$4,available_at=now() WHERE tenant_id=$1 AND id=$2",
        [
          job.tenant_id,
          job.id,
          status,
          "Worker interrupted; monitoring requests are not automatically replayed",
        ],
      );
      await event(c, job.tenant_id, null, "job.recovered", {
        jobId: job.id,
        status,
      });
    }
  });
}
export async function processOne(
  pool,
  {
    env = process.env,
    runner = execute,
    auditor = audit,
    renderer = null,
  } = {},
) {
  // One global dispatcher avoids provider bursts. PostgreSQL lock survives neither process nor connection failure.
  const lock = await pool.connect();
  const acquired = (
    await lock.query("SELECT pg_try_advisory_lock(782411) AS ok")
  ).rows[0].ok;
  if (!acquired) {
    lock.release();
    return false;
  }
  try {
    const job = await transaction(pool, async (c) => {
      const r = (
        await c.query(
          `SELECT * FROM visibility.jobs WHERE status='queued' AND available_at<=now() ORDER BY available_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        )
      ).rows[0];
      if (!r) return null;
      await c.query(
        "UPDATE visibility.jobs SET status='running',started_at=now(),attempts=attempts+1 WHERE tenant_id=$1 AND id=$2",
        [r.tenant_id, r.id],
      );
      return { ...r, attempts: r.attempts + 1 };
    });
    if (!job) return false;
    const tenant = job.tenant_id,
      p = job.payload;
    let usageId = null,
      output = null;
    try {
      if (job.kind === "audit") {
        const result = await auditor(p.domain, {
          renderer,
          urls: p.urls || [],
        });
        await transaction(pool, async (c) => {
          await c.query(
            "INSERT INTO visibility.audits(tenant_id,id,brand_id,data) VALUES($1,$2,$3,$4)",
            [tenant, randomUUID(), job.brand_id, result],
          );
          await c.query(
            "UPDATE visibility.jobs SET status='completed',finished_at=now() WHERE tenant_id=$1 AND id=$2",
            [tenant, job.id],
          );
          await event(c, tenant, null, "audit.completed", {
            jobId: job.id,
            brandId: job.brand_id,
            partial: result.partial,
          });
        });
        return true;
      }
      if (!coverage(env).find((x) => x.id === p.provider)?.ready)
        throw new Error("Provider not configured or terms not approved");
      const disposition = (
        await pool.query(
          "SELECT data FROM visibility.provider_checks WHERE tenant_id=$1 AND provider=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
          [tenant, p.provider],
        )
      ).rows[0];
      if (disposition?.data.status === "blocked")
        throw new Error(
          "Provider is blocked by the internal validation review",
        );
      // Encryption validation happens before a potentially charged request.
      seal({ check: true }, tenant, env);
      const c = executionConfig(p.provider, p, env);
      const inputBound =
        Buffer.byteLength(
          `${p.text}\n\nRequested answer language: ${p.language}. Geographic context: ${p.region}.`,
        ) * c.input;
      const conservative = Math.ceil(
        inputBound +
          c.maxOutputTokens * c.output +
          c.searchAllowance * c.search * 1e6,
      );
      if (c.reservation < conservative)
        throw new Error(
          "Per-execution reservation is below configured token/search allowance",
        );
      const throttle = await transaction(pool, async (db) => {
        await db.query(
          "INSERT INTO visibility.provider_throttle VALUES($1,now()) ON CONFLICT DO NOTHING",
          [p.provider],
        );
        const t = (
          await db.query(
            "SELECT next_at>now() AS wait,next_at FROM visibility.provider_throttle WHERE provider=$1 FOR UPDATE",
            [p.provider],
          )
        ).rows[0];
        if (t.wait) {
          await db.query(
            "UPDATE visibility.jobs SET status='queued',attempts=attempts-1,available_at=$3 WHERE tenant_id=$1 AND id=$2",
            [tenant, job.id, t.next_at],
          );
          return true;
        }
        await db.query(
          "UPDATE visibility.provider_throttle SET next_at=now()+interval '10 seconds' WHERE provider=$1",
          [p.provider],
        );
        return false;
      });
      if (throttle) return true;
      usageId = await transaction(pool, (cx) =>
        reserve(cx, tenant, job.id, p.provider, c.reservation),
      );
      output = await runner(p.provider, p, { env });
      const data = {
        status: "completed",
        source: "official_api",
        provider: p.provider,
        model: output.model || c.model,
        promptId: p.promptId,
        promptVersion: p.promptVersion,
        prompt: p.text,
        language: p.language,
        region: p.region,
        parameters: {
          ...output.request,
          input: undefined,
          contents: undefined,
          messages: undefined,
        },
        executionConfig: p.executionConfig || snapshot(p.provider, env),
        configurationFingerprint: fingerprint(
          p.executionConfig || snapshot(p.provider, env),
        ),
        extractionVersion: ADAPTER_VERSION,
        studyId: job.study_id,
        batchId: job.batch_id,
        studyStage: p.studyStage,
        providerMetadata: output.providerMetadata || null,
        searchCalls: output.searchCalls ?? null,
        brandSnapshot: p.brand,
        text: output.text,
        citations: output.citations,
        searched: output.searched,
        mentions: mentions(output.text, p.brand),
        usage: output.usage,
        costMicros: output.costMicros,
        costKind: output.costKind,
        localeControl: output.localeControl,
        raw: seal(output.raw, tenant, env),
      };
      await transaction(pool, async (db) => {
        await db.query(
          "INSERT INTO visibility.executions(tenant_id,id,job_id,brand_id,data) VALUES($1,$2,$3,$4,$5)",
          [tenant, randomUUID(), job.id, job.brand_id, data],
        );
        await db.query(
          "UPDATE visibility.usage SET actual_micros=$3,state=$4 WHERE tenant_id=$1 AND id=$2",
          [
            tenant,
            usageId,
            output.costKind === "provider_reported"
              ? output.costMicros
              : output.costMicros > c.reservation
                ? output.costMicros
                : null,
            output.costKind === "provider_reported"
              ? "settled"
              : output.costMicros === null
                ? "unknown"
                : "estimated_reserved",
          ],
        );
        await db.query(
          "UPDATE visibility.jobs SET status='completed',finished_at=now(),error=NULL WHERE tenant_id=$1 AND id=$2",
          [tenant, job.id],
        );
        await event(db, tenant, null, "monitoring.completed", {
          jobId: job.id,
          brandId: job.brand_id,
          costKind: output.costKind,
          searched: output.searched,
        });
      });
    } catch (e) {
      // If a response was received but persistence failed, never send another paid request.
      const uncertain = !!usageId && (e.uncertain || !!output || !e.retryable);
      const retry = e.retryable && !uncertain && job.attempts < 3;
      const status = uncertain ? "uncertain" : retry ? "queued" : "failed";
      await transaction(pool, async (c) => {
        if (usageId)
          await c.query(
            "UPDATE visibility.usage SET actual_micros=$3,state=$4 WHERE tenant_id=$1 AND id=$2",
            [
              tenant,
              usageId,
              uncertain ? null : 0,
              uncertain ? "unknown" : "rejected",
            ],
          );
        await c.query(
          "UPDATE visibility.jobs SET status=$3,error=$4,available_at=now()+interval '1 second'*$5,finished_at=CASE WHEN $3='queued' THEN NULL ELSE now() END WHERE tenant_id=$1 AND id=$2",
          [
            tenant,
            job.id,
            status,
            e.message,
            Math.min(300, 30 * 2 ** job.attempts),
          ],
        );
        if (!retry && job.kind === "monitor")
          await c.query(
            "INSERT INTO visibility.executions(tenant_id,id,job_id,brand_id,data) VALUES($1,$2,$3,$4,$5)",
            [
              tenant,
              randomUUID(),
              job.id,
              job.brand_id,
              {
                status,
                studyId: job.study_id,
                batchId: job.batch_id,
                studyStage: p.studyStage,
                brandSnapshot: p.brand,
                parameters: p.executionConfig || null,
                configurationFingerprint: fingerprint(
                  p.executionConfig || snapshot(p.provider, env),
                ),
                provider: p.provider,
                model: config(p.provider, env).model || null,
                promptId: p.promptId,
                promptVersion: p.promptVersion,
                language: p.language,
                region: p.region,
                error: e.message,
                raw: e.raw ? seal(e.raw, tenant, env) : undefined,
              },
            ],
          );
        await event(c, tenant, null, "job.failed", {
          jobId: job.id,
          status,
          error: e.message,
        });
      });
    }
    return true;
  } finally {
    await lock.query("SELECT pg_advisory_unlock(782411)");
    lock.release();
  }
}
async function main() {
  const pool = database();
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  const renderer =
    process.env.VISIBILITY_RENDER === "true"
      ? (await import("./renderer.js")).render
      : null;
  try {
    while (!stopping) {
      try {
        await recover(pool);
        await schedule(pool);
        await processOne(pool, { renderer });
      } catch (e) {
        console.error(
          JSON.stringify({
            event: "worker.failed",
            code: e.code || "internal",
          }),
        );
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("/src/worker.js"))
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
