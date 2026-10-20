# Phase 1 acceptance

Status: implemented for local internal evaluation; live-provider and deployment exit gates remain blocked pending operator configuration and validation. No Phase 2 or public release approval is implied.

Source implementation owner: Codex. Operational owner: to be assigned by the project owner. Deployment status for every row: not deployed. Existing Flocca auth, Stripe routes and extension behavior remain separate from this product.

| Requirement                                                         | Status                               | Evidence and tests                                                                                                                     | Risk and next action                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| FR-01 Brands, domains, aliases, competitors, locale, canonical URLs | Implemented                          | `src/validation.js`, `src/api.js`, dashboard brand form; database tests create independent brands and reject cross-tenant access       | Register two approved internal brands; verify actual configuration                                                  |
| FR-02 URL audits                                                    | Implemented                          | `src/crawler.js`, `src/renderer.js`; parser, robots, IP/DNS checks and real browser render fixture                                     | Bounded crawl; third-party rendering blocked; run real authorized sites and verify evidence                         |
| FR-03 Versioned prompt library                                      | Implemented                          | Immutable `prompt_versions`; import/version/pause and scheduler database tests                                                         | Freeze a baseline cohort before changes                                                                             |
| FR-04 Two grounded API adapters                                     | Implemented; live validation Blocked | OpenAI Responses and Perplexity Agent adapters in `src/providers.js`; fixture contract and failure tests                               | Supply credentials, approved terms, account-available models/rates and spend cap; record live responses from both   |
| FR-05 Citations and mentions                                        | Implemented                          | Labeled extraction fixtures: annotations, numbered references, absent citations, substring/domain impostors, uncertain aliases         | Review live false positives/negatives before trial approval                                                         |
| FR-06 Metrics, coverage, trends                                     | Implemented                          | `src/metrics.js`; numerator/denominator, zero-sample, cohort and daily trend behavior; dashboard/report tests                          | API samples only; ungrounded responses remain visible but ineligible                                                |
| FR-07 Recommendations                                               | Implemented                          | Audit findings include severity, evidence, remediation and verification; deployed changes reference an actual finding                  | Rule-based technical recommendations; usefulness requires developer validation                                      |
| FR-08 Retesting and comparisons                                     | Implemented                          | Repeat audits/runs; deployed-change timeline and seven-day matching cohort comparisons                                                 | No causal attribution; insufficient samples remain unavailable                                                      |
| FR-09 Jobs, retries, budgets, rate limits                           | Implemented                          | Durable PostgreSQL jobs, schedule deduplication, dispatcher lock, budget reservation races, uncertain charge and interrupted-job tests | Provider account caps also required; local estimates retain reservations; uncertain jobs need manual reconciliation |
| FR-10 Reports and event logs                                        | Implemented                          | Tenant-scoped JSON/CSV, filters, encrypted raw evidence and administrative events; export/security tests                               | DB/storage encryption and retention are deployment responsibilities                                                 |
| FR-11 Roles and tenant isolation                                    | Implemented                          | Internal scrypt login, HttpOnly sessions, membership-bound identity, composite tenant references; real PostgreSQL/API isolation tests  | Internal-only; no external beta approval; shared ingress rate limiting needed before scale-out                      |
| FR-12 AI referrals                                                  | Implemented                          | Aggregated import, source reference, known AI/other/direct classifications and referrer URL minimization tests                         | Manual additive imports; missing referrers cannot be attributed; avoid importing batches twice                      |

## Verification result

On 20 October 2026, all 38 automated checks passed with PostgreSQL 14 and Chromium enabled: zero failed and zero skipped. Desktop and 390 px mobile screenshots were inspected. Dependency installation reported zero vulnerabilities. Compose configuration was validated using a temporary fixture environment; a container build and staging deployment were not run locally because the Docker daemon was unavailable.

## Release gate evidence

- Automated loop: two independent brands, two API adapters and audit/report workflows exercised with explicitly synthetic fixtures in a disposable PostgreSQL database.
- Labeled citation and mention fixtures pass; no fixtures are installed into an internal deployment.
- Actual Chromium dashboard and JavaScript-render comparison checked separately from parser tests.
- Live two-brand baseline: Blocked until approved domains/prompts and provider account configuration are supplied.
- Account terms, provider billing reconciliation and real response-schema compatibility: Blocked pending live validation.
- Staging deployment, container sandbox, backup restoration and monitoring integration: Not Started operational validation.
- Owner approval for the internal measured trial: Pending.

No pricing, public signup, checkout, consumer-app ranking promises or automatic website changes were introduced. Claude, Gemini, Grok and Meta Muse Spark remain disabled planned providers for later validation.
