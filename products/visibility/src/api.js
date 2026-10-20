import {
  validationRoute,
  tenantValidationRoute,
} from "./validation-service.js";
import { snapshot, fingerprint } from "./providers.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  hashPassword,
  verifyPassword,
  identity,
  membership,
  token,
  digest,
  cookies,
} from "./auth.js";
import { transaction, event, enqueue } from "./db.js";
import { coverage, normalizedUrl } from "./providers.js";
import { cohorts, comparisons, csv, referral } from "./metrics.js";
import { unseal } from "./secrets.js";
import * as v from "./validation.js";
const assets = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/style.css", "style.css"],
  ["/validation.js", "validation.js"],
]);
export function app(pool, { env = process.env } = {}) {
  const limits = new Map();
  function rate(key, max, window = 60000) {
    const now = Date.now();
    if (limits.size > 10000)
      for (const [k, b] of limits) if (b.until < now) limits.delete(k);
    let b = limits.get(key);
    if (!b || b.until < now) {
      b = { until: now + window, count: 0 };
      limits.set(key, b);
    }
    return ++b.count <= max;
  }
  return async (req, res) => {
    const send = (status, data, type = "application/json") => {
      res.writeHead(status, {
        "Content-Type": `${type}; charset=utf-8`,
        "Cache-Control": "no-store",
      });
      res.end(type === "application/json" ? JSON.stringify(data) : data);
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; frame-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const requestUrl = new URL(req.url, "http://localhost");
      const path = requestUrl.pathname;
      if (req.method === "GET" && assets.has(path)) {
        const name = assets.get(path);
        return send(
          200,
          await readFile(new URL(`../public/${name}`, import.meta.url), "utf8"),
          name.endsWith(".js")
            ? "text/javascript"
            : name.endsWith(".css")
              ? "text/css"
              : "text/html",
        );
      }
      if (path === "/health" && req.method === "GET") {
        await pool.query("SELECT 1");
        return send(200, { status: "ok", product: "visibility" });
      }
      if (!path.startsWith("/api/")) return send(404, { error: "Not found" });
      if (!rate(`api:${req.socket.remoteAddress}`, 180))
        return send(429, { error: "Rate limit reached" });
      if (!["GET", "POST", "PUT"].includes(req.method))
        return send(405, { error: "Method not allowed" });
      let body = {};
      if (req.method !== "GET") {
        const expected =
          env.VISIBILITY_PUBLIC_ORIGIN ||
          `http://localhost:${env.PORT || 4100}`;
        if (req.headers.origin && req.headers.origin !== expected)
          return send(403, { error: "Origin rejected" });
        if (req.headers["sec-fetch-site"] === "cross-site")
          return send(403, { error: "Cross-site request rejected" });
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return send(415, { error: "JSON required" });
        const chunks = [];
        let n = 0;
        for await (const chunk of req) {
          n += chunk.length;
          if (n > 256000) return send(413, { error: "Request too large" });
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          if (!body || Array.isArray(body) || typeof body !== "object")
            throw new Error();
        } catch {
          return send(400, { error: "Invalid JSON object" });
        }
      }
      const secure = env.NODE_ENV === "production" ? "; Secure" : "";
      if (path === "/api/login" && req.method === "POST") {
        if (!rate(`login:${req.socket.remoteAddress}`, 6, 15 * 60000))
          return send(429, {
            error: "Too many login attempts; try in 15 minutes",
          });
        const email =
          typeof body.email === "string" ? body.email.toLowerCase() : "";
        const user = (
          await pool.query(
            "SELECT * FROM visibility.users WHERE email=$1 AND NOT disabled",
            [email],
          )
        ).rows[0];
        const fallback = hashPassword("unusable-placeholder-password");
        if (
          !verifyPassword(body.password, user?.password_hash || fallback) ||
          !user
        )
          return send(401, { error: "Invalid credentials" });
        const raw = token();
        await pool.query(
          "INSERT INTO visibility.sessions VALUES($1,$2,now()+interval '8 hours')",
          [digest(raw), user.id],
        );
        res.setHeader(
          "Set-Cookie",
          `visibility_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`,
        );
        return send(200, { ok: true });
      }
      const user = await identity(pool, req);
      if (!user) return send(401, { error: "Sign in required" });
      if (path === "/api/logout" && req.method === "POST") {
        await pool.query(
          "DELETE FROM visibility.sessions WHERE token_hash=$1",
          [digest(cookies(req).visibility_session)],
        );
        res.setHeader(
          "Set-Cookie",
          `visibility_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
        );
        return send(200, { ok: true });
      }
      if (path === "/api/me" && req.method === "GET")
        return send(200, {
          user,
          tenants: (
            await pool.query(
              "SELECT t.id,t.name,m.role FROM visibility.memberships m JOIN visibility.tenants t ON t.id=m.tenant_id WHERE m.user_id=$1",
              [user.id],
            )
          ).rows,
        });
      const tenant =
        path === "/api/search-suggestions"
          ? requestUrl.searchParams.get("tenant")
          : req.headers["x-visibility-tenant"];
      const member = await membership(pool, user.id, tenant);
      if (!member) return send(403, { error: "Organization access denied" });
      if (req.method !== "GET" && !["OWNER", "ADMIN"].includes(member.role))
        return send(403, { error: "Administrator access required" });
      if (path === "/api/search-suggestions" && req.method === "GET") {
        const brandId = requestUrl.searchParams.get("brand"),
          executionId = requestUrl.searchParams.get("execution");
        if (!v.uuid(brandId) || !v.uuid(executionId))
          return send(400, { error: "Invalid evidence reference" });
        const evidence = (
          await pool.query(
            "SELECT data FROM visibility.executions WHERE tenant_id=$1 AND brand_id=$2 AND id=$3",
            [tenant, brandId, executionId],
          )
        ).rows[0];
        if (!evidence || evidence.data.provider !== "gemini")
          return send(404, { error: "Suggestions not found" });
        const html = evidence.data.providerMetadata?.searchSuggestions;
        if (typeof html !== "string")
          return send(404, { error: "Suggestions unavailable" });
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox",
        );
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        return send(200, html, "text/html");
      }
      try {
        if (
          await tenantValidationRoute(pool, {
            tenant,
            user,
            member,
            path,
            body,
            method: req.method,
            send,
            env,
          })
        )
          return;
      } catch (e) {
        if (e.code) throw e;
        return send(e.status || 400, { error: e.message });
      }
      if (path === "/api/state" && req.method === "GET") {
        const [brands, prompts, jobs, usage, events, usageRecords] =
          await Promise.all([
            pool.query(
              "SELECT * FROM visibility.brands WHERE tenant_id=$1 ORDER BY created_at",
              [tenant],
            ),
            pool.query(
              "SELECT * FROM visibility.prompts WHERE tenant_id=$1 ORDER BY created_at",
              [tenant],
            ),
            pool.query(
              "SELECT id,brand_id,kind,status,attempts,error,created_at,finished_at FROM visibility.jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100",
              [tenant],
            ),
            pool.query(
              `SELECT t.monthly_cap_micros,(SELECT COALESCE(sum(COALESCE(actual_micros,reserved_micros)),0)::text FROM visibility.usage WHERE tenant_id=$1 AND month=date_trunc('month',now())::date) AS committed_micros FROM visibility.tenants t WHERE id=$1`,
              [tenant],
            ),
            pool.query(
              "SELECT action,data,created_at FROM visibility.events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50",
              [tenant],
            ),
            pool.query(
              "SELECT * FROM visibility.usage WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100",
              [tenant],
            ),
          ]);
        const checks = (
          await pool.query(
            "SELECT * FROM visibility.provider_checks WHERE tenant_id=$1 ORDER BY created_at,id",
            [tenant],
          )
        ).rows;
        return send(200, {
          brands: brands.rows,
          prompts: prompts.rows,
          jobs: jobs.rows,
          budget: usage.rows[0],
          events: events.rows,
          usage: usageRecords.rows,
          providers: coverage(env).map((p) => {
            const check = checks.filter((c) => c.provider === p.id).at(-1);
            const valid =
              check?.data.status === "validated" &&
              check.data.configurationFingerprint ===
                fingerprint(snapshot(p.id, env));
            return {
              ...p,
              ready: p.ready && check?.data.status !== "blocked",
              status:
                check?.data.status === "blocked"
                  ? `blocked: ${check.data.notes}`
                  : valid && p.ready
                    ? "live evidence validated"
                    : p.status,
              validation: check?.data || null,
            };
          }),
          role: member.role,
        });
      }
      if (path === "/api/brands" && req.method === "POST") {
        let data;
        try {
          data = v.brand(body);
        } catch (e) {
          return send(400, { error: e.message });
        }
        const id = randomUUID();
        await transaction(pool, async (c) => {
          await c.query(
            "INSERT INTO visibility.brands(tenant_id,id,data) VALUES($1,$2,$3)",
            [tenant, id, data],
          );
          await event(c, tenant, user.id, "brand.created", { id });
        });
        return send(201, { id });
      }
      const match = path.match(/^\/api\/brands\/([^/]+)(?:\/(.*))?$/);
      if (!match || !v.uuid(match[1])) return send(404, { error: "Not found" });
      const brandId = match[1],
        action = match[2] || "";
      const row = (
        await pool.query(
          "SELECT * FROM visibility.brands WHERE tenant_id=$1 AND id=$2",
          [tenant, brandId],
        )
      ).rows[0];
      if (!row) return send(404, { error: "Brand not found" });
      if (action === "studies" || action.startsWith("studies/")) {
        try {
          return await validationRoute(pool, {
            tenant,
            user,
            member,
            brand: row,
            action,
            body,
            method: req.method,
            send,
            env,
            key: req.headers["idempotency-key"] || randomUUID(),
          });
        } catch (e) {
          if (e.code) throw e;
          return send(e.status || 400, { error: e.message });
        }
      }
      if (!action && req.method === "PUT") {
        let data;
        try {
          data = v.brand(body);
        } catch (e) {
          return send(400, { error: e.message });
        }
        await transaction(pool, async (c) => {
          await c.query(
            "UPDATE visibility.brands SET data=$3 WHERE tenant_id=$1 AND id=$2",
            [tenant, brandId, data],
          );
          await event(c, tenant, user.id, "brand.updated", { id: brandId });
        });
        return send(200, { ok: true });
      }
      if (action === "audit" && req.method === "POST") {
        const job = await transaction(pool, async (c) => {
          const j = await enqueue(
            c,
            tenant,
            brandId,
            "audit",
            { domain: row.data.domain, urls: row.data.canonicalUrls || [] },
            `audit:${brandId}:${req.headers["idempotency-key"] || randomUUID()}`,
          );
          await event(c, tenant, user.id, "audit.queued", {
            brandId,
            jobId: j.id,
          });
          return j;
        });
        return send(202, job);
      }
      if (action === "prompts" && req.method === "POST") {
        const input = body.prompts || [body];
        if (!Array.isArray(input) || !input.length || input.length > 100)
          return send(400, { error: "Import 1–100 prompts" });
        let parsed;
        try {
          parsed = input.map(v.prompt);
        } catch (e) {
          return send(400, { error: e.message });
        }
        const ids = await transaction(pool, async (c) => {
          const ids = [];
          for (const data of parsed) {
            const id = randomUUID();
            ids.push(id);
            await c.query(
              `INSERT INTO visibility.prompts(tenant_id,id,brand_id,version,data,interval_minutes,next_run_at) VALUES($1,$2,$3,1,$4,$5,CASE WHEN $5::integer IS NULL THEN NULL ELSE now() END)`,
              [tenant, id, brandId, data, data.intervalMinutes],
            );
            await c.query(
              "INSERT INTO visibility.prompt_versions(tenant_id,prompt_id,version,data) VALUES($1,$2,1,$3)",
              [tenant, id, data],
            );
          }
          await event(c, tenant, user.id, "prompts.imported", {
            brandId,
            count: ids.length,
          });
          return ids;
        });
        return send(201, { ids });
      }
      if (action.startsWith("prompts/") && req.method === "PUT") {
        const id = action.slice(8);
        if (!v.uuid(id)) return send(404, { error: "Prompt not found" });
        const current = (
          await pool.query(
            "SELECT * FROM visibility.prompts WHERE tenant_id=$1 AND brand_id=$2 AND id=$3",
            [tenant, brandId, id],
          )
        ).rows[0];
        if (!current) return send(404, { error: "Prompt not found" });
        let data;
        try {
          data = v.prompt({ ...current.data, ...body });
          if (body.active !== undefined && typeof body.active !== "boolean")
            throw new Error("active must be boolean");
        } catch (e) {
          return send(400, { error: e.message });
        }
        await transaction(pool, async (c) => {
          const p = (
            await c.query(
              "SELECT * FROM visibility.prompts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [tenant, id],
            )
          ).rows[0];
          const version = p.version + 1;
          await c.query(
            "UPDATE visibility.prompts SET data=$3,version=$4,active=$5,interval_minutes=$6,next_run_at=CASE WHEN $6::integer IS NULL THEN NULL ELSE now() END WHERE tenant_id=$1 AND id=$2",
            [
              tenant,
              id,
              data,
              version,
              body.active ?? p.active,
              data.intervalMinutes,
            ],
          );
          await c.query(
            "INSERT INTO visibility.prompt_versions(tenant_id,prompt_id,version,data) VALUES($1,$2,$3,$4)",
            [tenant, id, version, data],
          );
          await event(c, tenant, user.id, "prompt.versioned", {
            id,
            version,
            active: body.active ?? p.active,
          });
        });
        return send(200, { ok: true });
      }
      if (action === "run" && req.method === "POST") {
        const prompts = (
          await pool.query(
            "SELECT * FROM visibility.prompts WHERE tenant_id=$1 AND brand_id=$2 AND active",
            [tenant, brandId],
          )
        ).rows;
        const enabled = coverage(env)
          .filter((p) => p.ready)
          .map((p) => p.id);
        const invalid = [
          ...new Set(prompts.flatMap((p) => p.data.providers)),
        ].filter((p) => !enabled.includes(p));
        if (invalid.length || !prompts.length)
          return send(409, {
            error: invalid.length
              ? `Providers unavailable: ${invalid.join(", ")}`
              : "Create an active prompt first",
          });
        const batch = req.headers["idempotency-key"] || randomUUID();
        if (typeof batch !== "string" || batch.length > 100)
          return send(400, { error: "Invalid idempotency key" });
        const jobs = await transaction(pool, async (c) => {
          const jobs = [];
          for (const p of prompts)
            for (const provider of p.data.providers)
              jobs.push(
                await enqueue(
                  c,
                  tenant,
                  brandId,
                  "monitor",
                  {
                    ...p.data,
                    promptId: p.id,
                    promptVersion: p.version,
                    provider,
                    brand: row.data,
                  },
                  `manual:${batch}:${p.id}:${p.version}:${provider}`,
                ),
              );
          await event(c, tenant, user.id, "monitoring.queued", {
            brandId,
            count: jobs.length,
          });
          return jobs;
        });
        return send(202, { jobs });
      }
      if (action === "changes" && req.method === "POST") {
        let data;
        try {
          const link = normalizedUrl(body.link);
          if (!link)
            throw new Error("A valid deployed-change link is required");
          data = {
            description: v.text(body.description, "description", 2000),
            link,
            findingId: v.text(body.findingId, "findingId", 200),
            deployedAt: new Date(body.deployedAt).toISOString(),
          };
        } catch (e) {
          return send(400, { error: e.message });
        }
        // A recommendation reference must belong to this brand and tenant.
        if (Date.parse(data.deployedAt) > Date.now())
          return send(400, { error: "Deployment time must be in the past" });
        const parts = data.findingId.split(":");
        const auditRow = v.uuid(parts[0])
          ? (
              await pool.query(
                "SELECT data FROM visibility.audits WHERE tenant_id=$1 AND brand_id=$2 AND id=$3",
                [tenant, brandId, parts[0]],
              )
            ).rows[0]
          : null;
        const findings = auditRow
          ? [
              ...(auditRow.data.findings || []),
              ...auditRow.data.pages.flatMap((p) => p.findings || []),
            ]
          : [];
        if (!/^\d+$/.test(parts[1] || "") || !findings[Number(parts[1])])
          return send(400, {
            error: "Finding must reference an audit finding for this brand",
          });
        await transaction(pool, async (c) => {
          await c.query(
            "INSERT INTO visibility.changes(tenant_id,id,brand_id,data) VALUES($1,$2,$3,$4)",
            [tenant, randomUUID(), brandId, data],
          );
          await event(c, tenant, user.id, "change.recorded", {
            brandId,
            ...data,
          });
        });
        return send(201, { ok: true });
      }
      if (action === "referrals" && req.method === "POST") {
        const rows = body.rows;
        if (!Array.isArray(rows) || !rows.length || rows.length > 500)
          return send(400, { error: "Import 1–500 aggregated rows" });
        let parsed;
        try {
          parsed = rows.map((r) => {
            const count = Number(r.count);
            if (!Number.isSafeInteger(count) || count < 0)
              throw new Error("Invalid count");
            const date = new Date(r.date).toISOString().slice(0, 10);
            const ref = r.referrer ? new URL(r.referrer).origin : "";
            return {
              date,
              referrer: ref,
              count,
              classification: referral(ref),
              source: v.text(body.source, "source", 200),
            };
          });
        } catch (e) {
          return send(400, { error: e.message });
        }
        await transaction(pool, async (c) => {
          for (const data of parsed)
            await c.query(
              "INSERT INTO visibility.referrals(tenant_id,id,brand_id,data) VALUES($1,$2,$3,$4)",
              [tenant, randomUUID(), brandId, data],
            );
          await event(c, tenant, user.id, "referrals.imported", {
            brandId,
            count: rows.length,
          });
        });
        return send(201, { ok: true });
      }
      if (
        (action === "report" || action === "report.csv") &&
        req.method === "GET"
      ) {
        const filterProvider = requestUrl.searchParams.get("provider") || null;
        const from = requestUrl.searchParams.get("from") || null,
          to = requestUrl.searchParams.get("to") || null;
        if (
          [from, to].some(
            (d) =>
              d &&
              (!/^\d{4}-\d{2}-\d{2}$/.test(d) ||
                !Number.isFinite(Date.parse(d))),
          ) ||
          (filterProvider &&
            !coverage(env).some((p) => p.id === filterProvider))
        )
          return send(400, { error: "Invalid report filters" });
        const [runs, audits, changes, refs] = await Promise.all([
          pool.query(
            "SELECT * FROM visibility.executions WHERE tenant_id=$1 AND brand_id=$2 AND ($3::text IS NULL OR data->>'provider'=$3) AND ($4::date IS NULL OR observed_at >= $4::date) AND ($5::date IS NULL OR observed_at < $5::date+interval '1 day') ORDER BY observed_at",
            [tenant, brandId, filterProvider, from, to],
          ),
          pool.query(
            "SELECT * FROM visibility.audits WHERE tenant_id=$1 AND brand_id=$2 ORDER BY observed_at DESC",
            [tenant, brandId],
          ),
          pool.query(
            "SELECT * FROM visibility.changes WHERE tenant_id=$1 AND brand_id=$2 ORDER BY created_at",
            [tenant, brandId],
          ),
          pool.query(
            "SELECT * FROM visibility.referrals WHERE tenant_id=$1 AND brand_id=$2 ORDER BY created_at",
            [tenant, brandId],
          ),
        ]);
        const safeRuns = runs.rows.map((r) => ({
          ...r,
          data: { ...r.data, raw: undefined },
        }));
        const report = {
          brand: row,
          generatedAt: new Date().toISOString(),
          filters: { provider: filterProvider, from, to },
          cohorts: cohorts(runs.rows, row.data),
          runs: safeRuns,
          audits: audits.rows,
          changes: changes.rows,
          comparisons: comparisons(runs.rows, changes.rows, row.data),
          referrals: refs.rows,
          methodology:
            "Official API samples only; eligible = completed search-grounded answers. Rates count each brand once per answer; uncertain mentions excluded. Cohorts separate prompt versions, model, locale and parameters. No inference of consumer-app rankings, causation or guaranteed citations. Referral imports are additive; import each source/date batch only once.",
        };
        await event(pool, tenant, user.id, "report.exported", {
          brandId,
          format: action.endsWith(".csv") ? "csv" : "json",
        });
        if (action.endsWith(".csv")) {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="flocca-visibility.csv"',
          );
          return send(
            200,
            csv([
              {
                type: "methodology",
                value: report.methodology,
                generatedAt: report.generatedAt,
              },
              ...safeRuns.map((r) => ({
                type: "execution",
                id: r.id,
                at: r.observed_at,
                ...r.data,
              })),
              ...audits.rows.map((r) => ({
                type: "audit",
                id: r.id,
                at: r.observed_at,
                data: r.data,
              })),
              ...changes.rows.map((r) => ({
                type: "change",
                at: r.created_at,
                data: r.data,
              })),
              ...refs.rows.map((r) => ({ type: "referral", data: r.data })),
            ]),
            "text/csv",
          );
        }
        return send(200, report);
      }
      if (action.startsWith("evidence/") && req.method === "GET") {
        const id = action.slice(9);
        if (!v.uuid(id)) return send(404, { error: "Not found" });
        const execution = (
          await pool.query(
            "SELECT data FROM visibility.executions WHERE tenant_id=$1 AND brand_id=$2 AND id=$3",
            [tenant, brandId, id],
          )
        ).rows[0];
        if (!execution) return send(404, { error: "Evidence not found" });
        await event(pool, tenant, user.id, "evidence.read", { id, brandId });
        return send(200, {
          ...execution.data,
          raw: execution.data.raw
            ? unseal(execution.data.raw, tenant, env)
            : null,
        });
      }
      return send(404, { error: "Not found" });
    } catch (e) {
      console.error(
        JSON.stringify({ event: "request.failed", code: e.code || "internal" }),
      );
      if (!res.headersSent)
        send(500, { error: "Request failed; check service logs" });
      else res.end();
    }
  };
}
