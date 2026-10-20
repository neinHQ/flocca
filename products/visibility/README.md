# Flocca Visibility

Internal website auditing and AI citation monitoring, separate from Flocca's MCP extension. The internal product provides a web dashboard, PostgreSQL API, durable worker and controlled validation studies. It has no public registration, checkout or pricing UI. Existing extension authentication and billing routes are not mounted.

## Local setup

Requires Node 22+, PostgreSQL 14+ and Chromium for rendered audits.

```sh
cd products/visibility
npm ci
npx playwright install chromium
cp .env.example .env
```

Use a dedicated database. Configure `VISIBILITY_DATABASE_URL`, generate `VISIBILITY_EVIDENCE_KEY` with `openssl rand -hex 32`, and set an internal operator email, a password of at least 14 characters, tenant name and explicit monthly USD cap. The example defaults the cap to zero. Set `VISIBILITY_PUBLIC_ORIGIN` to the exact browser origin, including port. Localhost and 127.0.0.1 are distinct origins.

```sh
npm run migrate
npm run bootstrap
npm start
# In a separate terminal, from the same directory:
npm run worker
```

Open http://localhost:4100 and sign in. Remove the bootstrap password from the environment after provisioning. The CLI does not seed brands, prompt answers, metrics or paid requests. Register only approved internal domains in the UI, create/import prompts, then run an audit and monitoring sample.

To add another internal operator or attach an existing user, set `VISIBILITY_ADMIN_EMAIL`, `VISIBILITY_ADMIN_PASSWORD` (new users only), `VISIBILITY_TENANT_ID`, `VISIBILITY_MEMBER_ROLE` (`OWNER`, `ADMIN`, `MEMBER`) and run:

```sh
node --env-file-if-exists=.env scripts/manage.js member
```

This is an infrastructure-admin command, not a public endpoint. Members can read/export; owners and admins can configure brands, prompts, imports and jobs. A disabled user cannot authenticate or use an existing session. Sessions expire after eight hours; logout revokes them. Provisioning passwords are salted with scrypt. Cookies are HttpOnly and SameSite Strict, and Secure in production. Mutations require JSON and reject foreign browser origins.

## Provider configuration

Phase 2 adds Claude Search, Gemini Search Grounding, Grok Search and Meta Muse Spark adapters to the existing OpenAI and Perplexity adapters. All six remain disabled until their access, model, terms and rates are explicitly configured. No adapter is advertised as live-validated by configuration alone. See [Phase 2 acceptance](PHASE2_ACCEPTANCE.md) for the remaining operational gates.

For each implemented provider, supply its API key, exact model, explicit terms approval, three current USD rates and per-execution reservation ceiling in `.env`. Every field is required; explicit zero rates are permitted, blank rates are not. Terms approval means the operator has reviewed account access, prompt/response storage, retention and display rights. Model selection is explicit; there is no hidden fallback. No keys are returned to browsers or placed in logs.

- OpenAI: POST `https://api.openai.com/v1/responses`, `web_search`, at most one tool call, 1,200 output tokens, `store:false`.
- Perplexity: POST `https://api.perplexity.ai/v1/agent`, explicit model, `web_search`, at most one tool call, 1,200 output tokens. This uses the current Agent API rather than legacy Sonar Chat Completions.

- Claude: POST `https://api.anthropic.com/v1/messages`, basic `web_search_20250305`, `max_uses:1`, 1,200 output tokens. Search errors inside HTTP 200 and paused/truncated turns fail closed.
- Gemini: POST `https://generativelanguage.googleapis.com/v1beta/models/MODEL:generateContent`, `google_search`, one candidate, 1,200 output tokens. Set `GEMINI_SEARCH_RESERVE_CALLS` explicitly. This is a reservation allowance, not an enforced search-query ceiling. Grounding supports determine citations; thought parts and unused grounding chunks are excluded.
- Grok: POST `https://api.x.ai/v1/responses`, `web_search`, at most one tool call. Encountered source lists are not counted as answer citations.
- Meta: POST `https://api.meta.ai/v1/responses`, `web_search`, at most one tool call. Labels refer to the Model API, not the Muse consumer app.

The model may decline to search. Successful ungrounded answers remain visible but are excluded from citation/mention rate denominators. Region/language are prompt context, not guaranteed geographic emulation. Responses are samples from the named API, not consumer-app rankings or personalized-agent observations.

Contracts checked against official documentation on 20 October 2026:

- [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Perplexity Agent API](https://docs.perplexity.ai/docs/agent-api/quickstart)
- [Claude web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- [Gemini grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search)
- [Gemini current terms](https://ai.google.dev/gemini-api/terms)
- [Grok citations](https://docs.x.ai/developers/tools/citations)
- [Meta search grounding](https://dev.meta.ai/docs/cookbook/search-grounding)
- [Perplexity migration guidance](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview)

### Costs and recovery

Tenant/month budget reservations are serialized in PostgreSQL before dispatch. The request's configured token/search allowance must fit its reservation. Actual provider-reported costs settle the reservation. Locally estimated costs remain labeled estimates and retain the reservation, rather than releasing uncertain headroom. Unknown charges retain their full reservation. Reservations are per month of dispatch. A single global dispatcher plus a persistent ten-second provider spacing bounds Phase 1 throughput.

This is an application budget control, not a contractual ceiling on a third party's invoice. Configure matching provider-account spend limits and conservative rates/ceilings, and reconcile usage before increasing caps. Unexpected provider-reported overages count in full and prevent further reservations. Worker timeouts/5xx/schema failures are not automatically replayed because a charge may already have occurred. Only explicit 429 rejections are automatically retried, at most three attempts with backoff. There is no cross-run answer cache: each observation is an actual execution. Robots policies are cached within an audit.

Interrupted monitor jobs become `uncertain` after ten minutes and retain reservations; audit jobs can be recovered. PostgreSQL advisory locks prevent another worker from reaping a live dispatch. An operator should inspect logs/provider billing before manually reconciling unknown usage. Do not blindly reset uncertain jobs to queued.

## Audit and measurement

Audits crawl at most 12 pages, 72 requests and two MB per response, with serialized requests and robots crawl delays. Only public HTTPS on port 443 is permitted. DNS results are validated and pinned to the outbound connection. Private/reserved targets, cross-origin redirects and unauthorized sitemap domains are blocked. Robots errors fail closed. URL evidence includes status, redirect chain, metadata, canonical, noindex signals, JSON-LD syntax and fetched-text visibility. This does not verify actual inclusion in a search index or validate every schema vocabulary.

With `VISIBILITY_RENDER=true`, isolated Chromium compares fetched and rendered text. Browser GETs pass through the same public-network/robots checks; websockets, third-party resources, service workers and downloads are blocked. Rendering may be partial when resources are blocked. A missing browser or render failure is recorded, never presented as a passing rendered-content audit. Container deployments must support Chromium's sandbox; do not disable it for untrusted websites. Confirm the rendered audit works in staging before opening the internal trial.

Every audit finding includes evidence, severity, remediation and verification steps. These are rule-based recommendations, not invented citation predictions. Record deployed changes against a specific finding and deployed-change URL; rerun audits to verify. Monitoring comparisons use seven-day windows before/after each deployment and separate matching cohorts. They describe association, not causation.

Metrics count each brand once per eligible answer. Uncertain short/ambiguous aliases are flagged and excluded from mention/share-of-voice counts. Citations require provider annotations, or Perplexity numbered answer references resolved against its returned search results. Merely retrieved candidates and unlinked mentions are not citations. Cohorts separate provider, model, prompt version, locale, parameters and brand snapshot. Daily counts use UTC; empty denominators display as unavailable. Failed/ungrounded samples remain in coverage counts.

Referral imports accept aggregated JSON rows (`date`, `referrer`, `count`) plus an export/source reference. Only referrer origin is retained, to avoid saving private query strings. Recognized AI domains, other referrers and direct/unattributed rows remain separate. Imports are additive: import each batch once. This is a manual connector/import, not a claim to identify AI visits with missing referrers.

## API contract

All `/api` routes other than login require an authenticated cookie. Tenant routes additionally require `X-Visibility-Tenant` bound to a verified membership. The old `x-flocca-user-id` header grants no access. Every brand lookup, nested resource, report and evidence request is tenant-scoped. Admin writes use transactions and persist administrative events.

| Method | Path                                    | Purpose                                                           |
| ------ | --------------------------------------- | ----------------------------------------------------------------- |
| POST   | `/api/login`, `/api/logout`             | Start/revoke internal session                                     |
| GET    | `/api/me`                               | Identity and permitted organizations                              |
| GET    | `/api/state`                            | Brands, prompts, queue, budget, provider configuration and events |
| POST   | `/api/brands`                           | Create brand and competitor configuration                         |
| PUT    | `/api/brands/:id`                       | Edit brand                                                        |
| POST   | `/api/brands/:id/audit`                 | Queue audit                                                       |
| POST   | `/api/brands/:id/prompts`               | Create one prompt or import `{prompts:[...]}`                     |
| PUT    | `/api/brands/:id/prompts/:promptId`     | New immutable version and/or active state                         |
| POST   | `/api/brands/:id/run`                   | Queue all active prompts across their configured providers        |
| GET    | `/api/brands/:id/report[.csv]`          | Evidence report/export; optional `provider`, `from`, `to` filters |
| GET    | `/api/brands/:id/evidence/:executionId` | Authorized decryption of raw provider evidence                    |
| POST   | `/api/brands/:id/changes`               | Record deployed improvement against audit finding                 |
| POST   | `/api/brands/:id/referrals`             | Import aggregated referral rows                                   |

Audit and run requests accept `Idempotency-Key` for safe transport retries. Scheduled jobs also deduplicate by tenant, prompt version, provider and scheduled time. Missed intervals collapse into one current execution; no historical answers are invented. Raw provider payloads are encrypted with AES-256-GCM and tenant-bound additional authenticated data. Answer text and metrics require database/storage encryption at rest at deployment. Evidence-key rotation requires re-encrypting existing records; back up the key separately from the database.

## Verification

```sh
npm test
# Disposable PostgreSQL database name MUST end with visibility_test.
VISIBILITY_TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/flocca_visibility_test npm test
# Include actual Chromium dashboard and rendering checks:
VISIBILITY_TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/flocca_visibility_test VISIBILITY_BROWSER_TESTS=true npm test
```

The integration suite truncates visibility data in the designated disposable test database. Never point it at internal or production data. Tests without the database variable explicitly skip integration coverage. Provider answers and website responses in tests are synthetic fixtures, not live baseline observations. GitHub Actions runs database tests, browser tests and a container build on relevant changes. See [Phase 1 acceptance](PHASE1_ACCEPTANCE.md).

## Deployment and operations

Docker Compose provides a separate PostgreSQL volume, migration job, API and worker. Set `VISIBILITY_DB_PASSWORD` to a random URL-safe password, configure `.env`, and set `VISIBILITY_PUBLIC_ORIGIN` to the actual HTTPS internal hostname. `docker compose up --build -d` applies migrations before starting services. API binds only to host loopback; expose it through an authenticated internal HTTPS reverse proxy or existing tunnel. Never expose the database port publicly. Container and remote deployment have not been validated by local source tests.

Before staging: restrict network access to the internal team, enable database encryption/backups and TLS for remote DB access, configure provider-account budgets, and verify sandboxed Chromium. Configure log collection for `request.failed`, `worker.failed`, HTTP 5xx, failed/uncertain jobs and budget exhaustion. `/health` checks DB connectivity; monitor worker progress separately using recent job completion timestamps. Structured logs deliberately exclude prompts, keys and database URLs. Persisted events provide tenant-level history.

Deploy dev/stage/prod with separate databases, secrets and provider keys. Migrations run transactionally under an advisory lock and record applied versions. Back up with `pg_dump` and test restoration into a separate database. Roll back the app image before considering schema rollback; preserve evidence and usage accounting. This first migration is additive in the `visibility` schema. No automatic phase advancement or public deployment occurs.

Phase 1 uses one dispatcher and per-process HTTP rate limiting. Before horizontally scaling API instances or admitting beta customers, add a shared ingress rate limiter, durable alert delivery, full retention/deletion workflows and production-scale pagination. Current launch gate remains internal-only and subject to owner approval.

## Phase 2 internal validation workflow

Apply migrations with `npm run migrate`; migration 002 adds studies, batches, reviews, dispositions, validation evidence and reconciliation history, plus nullable study references on jobs. Existing Phase 1 records are preserved. Restart both API and worker together. Old studies refuse incompatible adapter versions; create a fresh manifest when adapter behavior changes rather than silently mixing results.

1. Configure the providers available to the internal team. Select explicit account-supported models and current rates; review each provider's storage, display and access terms. Register only approved internal sites.
2. Create consistent branded/unbranded prompts per product. In **Controlled studies**, select prompts and agree review/sample/accuracy/reliability/cost thresholds. Freeze the study. Prompt/model/locale/brand edits afterward do not rewrite the study.
3. Queue a **baseline** with a documented repetition count. Each batch uses the frozen configuration and server-side deduplication. No missed historical observations are generated. Finish the baseline before deploying selected improvements.
4. Inspect the raw answers and independently label expected citation URLs and mentioned tracked domains. The review queue uses deterministic hash ordering; it is a convenience sample, not random population coverage. Toggle previously reviewed samples to append corrections. The report uses the latest review per execution while retaining history. Precision and recall with no positive denominator remain unknown.
5. Audit owned sites, apply selected improvements through ordinary development review, and record the deployed change against an actual finding. Verify the finding with evidence. Follow-up batches require changes deployed after the last grounded baseline observation; baseline is closed after follow-up begins.
6. Compare matching prompt/configuration cohorts. Resolved model-version drift is flagged even when a requested alias is unchanged. Different provider/model/locale/prompt versions are not pooled as equivalent; missing and unresolved evidence remain visible.
7. Review **Provider validation dispositions**. Validated requires successful grounded execution IDs matching the current configuration. Blocked prevents further dispatch; pending reopens testing. All six candidates need a validated or blocked disposition for a study's checks, and every measured provider must have matching validation and current access. No credential value is stored in the manifest.
8. Review per-provider cost per 1,000 eligible answers, aggregate cost per 1,000 attempts and successful executions, retry overhead, unknown charges and timed worker attempts. Owners can reconcile a usage attempt with an actual USD charge and billing evidence URL; previous values remain in reconciliation history and events. Estimated charges retain conservative reservations. Unknown charges prevent the cost gate from passing.
9. Record staging drills/incidents with scenario, evidence, status and resolution notes. Resolve open incidents. Export the repeatable study CSV and review its quality/cost/reliability evidence.
10. An owner records **hold** or **approve private beta scope**. Approval is rejected until all study checks pass. The decision stores its evidence fingerprint and checks. New evidence, model/configuration changes or loss of access invalidate its current-snapshot status. It does not enable Phase 3 features or replace the project owner's multi-brand and prerequisite release review.

Gemini answers retain required Search Suggestions. The dashboard displays provider HTML in an authenticated tenant-bound iframe with scripts, forms, base changes and parent access blocked by CSP/sandbox. Operator review of current provider display/storage terms is still required. Opaque Google redirect URLs are preserved as evidence and flagged; citation-rate denominators exclude answers whose cited domains cannot be evaluated. They do not become fabricated negatives or guessed brand matches. Such unresolved domains block the study's release checks.

### Phase 2 API additions

All existing authentication, tenant scoping and administrator-write rules apply. Billing reconciliation and gate decisions require OWNER membership.

| Method     | Path                                                    | Purpose                                                                                                            |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET / POST | `/api/brands/:id/studies`                               | List studies / freeze a study manifest                                                                             |
| GET        | `/api/brands/:id/studies/:studyId`                      | Quality, operations, comparisons and evidence-gate report                                                          |
| GET        | `/api/brands/:id/studies/:studyId/report.csv`           | Export validation evidence and methodology                                                                         |
| POST       | `/api/brands/:id/studies/:studyId/batches`              | Queue baseline/follow-up with `stage`, `repetitions`, optional `changeIds` and Idempotency-Key                     |
| POST       | `/api/brands/:id/studies/:studyId/reviews/:executionId` | Record independent expected `citationUrls`, `mentionDomains`, `reviewedRaw`, `notes` after inspecting raw evidence |
| POST       | `/api/brands/:id/studies/:studyId/recommendations`      | Developer `verdict`, `changeId`, `evidenceUrl`, `notes`                                                            |
| POST       | `/api/brands/:id/studies/:studyId/incidents`            | Record drill/incident or update an existing `incidentId`; events retain history                                    |
| POST       | `/api/brands/:id/studies/:studyId/decision`             | Owner `outcome` (`hold` / `approve_beta`) and `notes`                                                              |
| POST       | `/api/provider-checks`                                  | `provider`, `status` (`pending` / `validated` / `blocked`), `evidenceExecutionIds`, `notes`                        |
| POST       | `/api/usage/:usageId/reconcile`                         | Owner actual USD charge plus evidence URL and notes                                                                |
| GET        | `/api/search-suggestions?tenant=…&brand=…&execution=…`  | Isolated Gemini suggestions document; query tenant is membership-checked                                           |

Controlled-study tests include six synthetic provider loops, version/configuration drift, review corrections, premature gate rejection, blocked dispatch, invoice reconciliation and decision staleness. Real baseline answers, measured accuracy, website improvements and beta approval still require the actual internal trial. No provider keys or live observations are bundled into the application.
