import pg from "pg";
import { randomUUID } from "node:crypto";
export function database(url = process.env.VISIBILITY_DATABASE_URL) {
  if (!url) throw new Error("VISIBILITY_DATABASE_URL is required");
  return new pg.Pool({ connectionString: url, max: 10 });
}
export async function transaction(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function event(c, tenant, actor, action, data = {}) {
  await c.query("INSERT INTO visibility.events VALUES($1,$2,$3,$4,$5,now())", [
    tenant,
    randomUUID(),
    actor,
    action,
    data,
  ]);
}
export async function enqueue(
  c,
  tenant,
  brand,
  kind,
  payload,
  key = randomUUID(),
) {
  const r = await c.query(
    `INSERT INTO visibility.jobs(tenant_id,id,brand_id,kind,payload,dedupe_key)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,dedupe_key) DO NOTHING RETURNING *`,
    [tenant, randomUUID(), brand, kind, payload, key],
  );
  return (
    r.rows[0] ||
    (
      await c.query(
        "SELECT * FROM visibility.jobs WHERE tenant_id=$1 AND dedupe_key=$2",
        [tenant, key],
      )
    ).rows[0]
  );
}
export async function reserve(c, tenant, job, provider, amount) {
  // Serializes every budget reservation within a tenant across worker processes.
  const t = (
    await c.query("SELECT * FROM visibility.tenants WHERE id=$1 FOR UPDATE", [
      tenant,
    ])
  ).rows[0];
  const used = (
    await c.query(
      `SELECT COALESCE(sum(COALESCE(actual_micros,reserved_micros)),0)::text AS total
    FROM visibility.usage WHERE tenant_id=$1 AND month=date_trunc('month',now())::date`,
      [tenant],
    )
  ).rows[0];
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    Number(used.total) + amount > Number(t.monthly_cap_micros)
  ) {
    throw new Error("Monthly spend cap reached");
  }
  const id = randomUUID();
  await c.query(
    `INSERT INTO visibility.usage(tenant_id,id,job_id,provider,month,reserved_micros)
    VALUES($1,$2,$3,$4,date_trunc('month',now())::date,$5)`,
    [tenant, id, job, provider, amount],
  );
  return id;
}
