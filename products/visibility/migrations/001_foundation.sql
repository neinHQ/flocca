CREATE SCHEMA IF NOT EXISTS visibility;
CREATE TABLE visibility.tenants (
 id uuid PRIMARY KEY, name text NOT NULL, monthly_cap_micros bigint NOT NULL CHECK(monthly_cap_micros >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE visibility.users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, disabled boolean NOT NULL DEFAULT false
);
CREATE TABLE visibility.memberships (
 tenant_id uuid REFERENCES visibility.tenants(id), user_id uuid REFERENCES visibility.users(id),
 role text NOT NULL CHECK(role IN ('OWNER','ADMIN','MEMBER')), PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE visibility.sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES visibility.users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE visibility.brands (
 tenant_id uuid REFERENCES visibility.tenants(id), id uuid NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE visibility.prompts (
 tenant_id uuid NOT NULL, id uuid NOT NULL, brand_id uuid NOT NULL, version integer NOT NULL,
 data jsonb NOT NULL, active boolean NOT NULL DEFAULT true, interval_minutes integer CHECK(interval_minutes >= 60),
 next_run_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,brand_id) REFERENCES visibility.brands(tenant_id,id)
);
CREATE TABLE visibility.prompt_versions (
 tenant_id uuid NOT NULL, prompt_id uuid NOT NULL, version integer NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,prompt_id,version),
 FOREIGN KEY(tenant_id,prompt_id) REFERENCES visibility.prompts(tenant_id,id)
);
CREATE TABLE visibility.jobs (
 tenant_id uuid NOT NULL, id uuid NOT NULL, brand_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('audit','monitor')),
 dedupe_key text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz, error text,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,dedupe_key),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES visibility.brands(tenant_id,id)
);
CREATE INDEX visibility_job_queue ON visibility.jobs(status,available_at);
CREATE TABLE visibility.executions (
 tenant_id uuid NOT NULL, id uuid NOT NULL, job_id uuid NOT NULL, brand_id uuid NOT NULL,
 data jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES visibility.jobs(tenant_id,id),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES visibility.brands(tenant_id,id)
);
CREATE TABLE visibility.audits (
 tenant_id uuid NOT NULL, id uuid NOT NULL, brand_id uuid NOT NULL, data jsonb NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES visibility.brands(tenant_id,id)
);
CREATE TABLE visibility.changes (
 tenant_id uuid NOT NULL, id uuid NOT NULL, brand_id uuid NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES visibility.brands(tenant_id,id)
);
CREATE TABLE visibility.referrals (
 tenant_id uuid NOT NULL, id uuid NOT NULL, brand_id uuid NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES visibility.brands(tenant_id,id)
);
CREATE TABLE visibility.events (
 tenant_id uuid REFERENCES visibility.tenants(id), id uuid NOT NULL, actor_id uuid, action text NOT NULL,
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE visibility.usage (
 tenant_id uuid NOT NULL REFERENCES visibility.tenants(id), id uuid NOT NULL, job_id uuid NOT NULL,
 provider text NOT NULL, month date NOT NULL, reserved_micros bigint NOT NULL CHECK(reserved_micros > 0),
 actual_micros bigint CHECK(actual_micros >= 0), state text NOT NULL DEFAULT 'reserved',
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES visibility.jobs(tenant_id,id)
);
CREATE INDEX visibility_usage_month ON visibility.usage(tenant_id,month);
CREATE TABLE visibility.provider_throttle (provider text PRIMARY KEY, next_at timestamptz NOT NULL);
