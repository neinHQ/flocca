CREATE TABLE visibility.studies (
 tenant_id uuid NOT NULL, id uuid NOT NULL, brand_id uuid NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES visibility.brands(tenant_id,id)
);
CREATE TABLE visibility.batches (
 tenant_id uuid NOT NULL, id uuid NOT NULL, study_id uuid NOT NULL,
 stage text NOT NULL CHECK(stage IN ('baseline','followup')), data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,study_id) REFERENCES visibility.studies(tenant_id,id)
);
ALTER TABLE visibility.jobs ADD COLUMN study_id uuid, ADD COLUMN batch_id uuid;
ALTER TABLE visibility.jobs ADD CONSTRAINT visibility_job_study FOREIGN KEY(tenant_id,study_id) REFERENCES visibility.studies(tenant_id,id);
ALTER TABLE visibility.jobs ADD CONSTRAINT visibility_job_batch FOREIGN KEY(tenant_id,batch_id) REFERENCES visibility.batches(tenant_id,id);
CREATE INDEX visibility_study_jobs ON visibility.jobs(tenant_id,study_id);
CREATE TABLE visibility.reviews (
 tenant_id uuid NOT NULL, id uuid NOT NULL, execution_id uuid NOT NULL, reviewer_id uuid NOT NULL REFERENCES visibility.users(id),
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,execution_id) REFERENCES visibility.executions(tenant_id,id)
);
CREATE TABLE visibility.provider_checks (
 tenant_id uuid NOT NULL, id uuid NOT NULL, provider text NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id) REFERENCES visibility.tenants(id)
);
CREATE TABLE visibility.validations (
 tenant_id uuid NOT NULL, id uuid NOT NULL, study_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('recommendation','incident','decision')), data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,study_id) REFERENCES visibility.studies(tenant_id,id)
);
CREATE TABLE visibility.reconciliations (
 tenant_id uuid NOT NULL, id uuid NOT NULL, usage_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES visibility.users(id), data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,usage_id) REFERENCES visibility.usage(tenant_id,id)
);
