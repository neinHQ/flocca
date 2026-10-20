import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { database, transaction, event } from "../src/db.js";
import { hashPassword } from "../src/auth.js";
export async function migrate(pool) {
  await transaction(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(782410)");
    await c.query("CREATE SCHEMA IF NOT EXISTS visibility");
    await c.query(
      "CREATE TABLE IF NOT EXISTS visibility.migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
    );
    for (const name of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      if (
        (
          await c.query("SELECT 1 FROM visibility.migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      )
        continue;
      await c.query(
        await readFile(
          new URL(`../migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
      await c.query("INSERT INTO visibility.migrations(name) VALUES($1)", [
        name,
      ]);
    }
  });
}
async function main() {
  const pool = database();
  try {
    if (process.argv[2] === "migrate") {
      await migrate(pool);
      console.log("Visibility migrations applied");
    } else if (process.argv[2] === "bootstrap") {
      const {
        VISIBILITY_ADMIN_EMAIL: email,
        VISIBILITY_ADMIN_PASSWORD: password,
        VISIBILITY_TENANT_NAME: name,
        VISIBILITY_MONTHLY_CAP_USD: cap,
      } = process.env;
      if (!email || !name || !Number.isFinite(Number(cap)) || Number(cap) < 0)
        throw new Error(
          "Set admin email, password, tenant name and explicit monthly cap",
        );
      const hash = hashPassword(password);
      const tenant = randomUUID(),
        user = randomUUID();
      await transaction(pool, async (c) => {
        await c.query(
          "INSERT INTO visibility.users(id,email,password_hash) VALUES($1,$2,$3)",
          [user, email.toLowerCase(), hash],
        );
        await c.query(
          "INSERT INTO visibility.tenants(id,name,monthly_cap_micros) VALUES($1,$2,$3)",
          [tenant, name, Math.round(Number(cap) * 1e6)],
        );
        await c.query(
          "INSERT INTO visibility.memberships VALUES($1,$2,'OWNER')",
          [tenant, user],
        );
      });
      console.log(
        `Internal operator created. Organization: ${tenant}. No brands or paid executions seeded.`,
      );
    } else if (process.argv[2] === "member") {
      const {
        VISIBILITY_ADMIN_EMAIL: email,
        VISIBILITY_ADMIN_PASSWORD: password,
        VISIBILITY_TENANT_ID: tenant,
        VISIBILITY_MEMBER_ROLE: role = "MEMBER",
      } = process.env;
      if (!email || !tenant || !["OWNER", "ADMIN", "MEMBER"].includes(role))
        throw new Error("Set member email, tenant ID and a valid role");
      await transaction(pool, async (c) => {
        let user = (
          await c.query("SELECT id FROM visibility.users WHERE email=$1", [
            email.toLowerCase(),
          ])
        ).rows[0];
        if (!user) {
          user = { id: randomUUID() };
          await c.query(
            "INSERT INTO visibility.users(id,email,password_hash) VALUES($1,$2,$3)",
            [user.id, email.toLowerCase(), hashPassword(password)],
          );
        }
        await c.query(
          "INSERT INTO visibility.memberships VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=EXCLUDED.role",
          [tenant, user.id, role],
        );
        await event(c, tenant, user.id, "membership.provisioned", { role });
      });
      console.log("Internal membership provisioned");
    } else throw new Error("Use migrate, bootstrap or member");
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("/scripts/manage.js"))
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
