# Phase 2 acceptance

Status: Phase 2 engineering implemented for internal evaluation. Real-world validation, provider support admission and private beta approval are pending live evidence. Phase 1's live-provider and staging gates have not been bypassed.

Implementation owner: Codex. Operational trial owner and developer reviewers: to be assigned by the project owner. Deployment status: not deployed. All automated provider answers, labels, billing reconciliations and owner decisions in the test suite are explicitly synthetic fixtures in a disposable database.

| Phase 2 deliverable               | Status                                         | Implementation and acceptance evidence                                                                                                                                                               | Operational next action                                                                                                   |
| --------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Six provider adapters             | Implemented; live validation Blocked           | Official OpenAI, Perplexity, Claude, Gemini, Grok and Meta request builders; provider-specific citation and usage parsers; contract and failure fixtures                                             | Configure permitted account access, models, rates and terms; run actual approved prompts; validate or block each provider |
| Fixed prompt cohorts and baseline | Implemented                                    | Immutable study manifest freezes prompt versions, brand/competitor definitions, locale, model/rates, adapter version and thresholds; hashes exclude keys; controlled batch deduplication tested      | Select a documented representative prompt set and agreed thresholds before capture                                        |
| Human mention/citation review     | Implemented                                    | Raw-evidence inspection required; append-only labels and corrections; precision, recall, false positives and false negatives; empty denominators remain unknown                                      | Review actual sampled answers independently; record accuracy and investigate extraction problems                          |
| Technical improvements            | Tracking implemented; real changes Not Started | Finding-bound deployed-change records and developer verification evidence; follow-up requires changes deployed after the baseline                                                                    | Audit approved owned sites, select findings, implement through ordinary review, verify and record actual deployed changes |
| Controlled retesting              | Implemented                                    | Baseline closes once follow-up starts; frozen inputs survive prompt/model edits; matching cohorts and resolved-model drift shown                                                                     | Repeat actual measurements with equivalent settings and interpret variability without causal claims                       |
| Cost and unit economics           | Implemented                                    | Per-provider and total conservative USD per 1,000 eligible answers; actual/reconciled, estimated and uncertain charges separate; owner reconciliation preserves billing evidence and history         | Verify current prices, compare invoices and settle ambiguous charges before the gate                                      |
| Reliability and incident handling | Implemented                                    | Planned/terminal/failed/uncertain counts, failure rates, timed attempt mean/p95, structured operational evidence; failure/retry/recovery tests retained                                              | Exercise real staging failure scenarios and link logs/runbooks; resolve open incidents                                    |
| Evidence report and owner gate    | Implemented                                    | JSON/CSV reports include frozen methodology, sample sizes, quality, costs, provider dispositions and checks; owner-only snapshot decisions; later evidence/access changes make prior decisions stale | Review all internal products and prerequisite Phase 1 gates, then explicitly decide private beta scope                    |

## Provider caveats

Configuration means execution can be attempted; it is not evidence of supported coverage. A provider is marked validated only with grounded execution IDs matching the current configuration. A blocked disposition stops dispatch before a charged request. Pending explicitly reopens testing. Changing model, rates or adapter configuration makes validation evidence stale. All studied providers must have matching validation; other candidates can remain explicitly blocked.

Claude tool errors can arrive inside HTTP 200 responses; these are retained as uncertain attempts rather than eligible answers. Gemini grounding counts only sources linked by grounding supports, retains Search Suggestions for isolated display, and excludes opaque redirect-domain answers from citation-rate denominators. Unresolved citation domains prevent a study's release checks from passing. There is no unsafe redirect resolution or fabricated brand attribution. Grok's encountered-source lists are not counted as answer citations; only positioned annotations or inline answer references qualify.

Gemini does not expose a hard search-query cap in this integration. Its configured search reservation allowance is a conservative budget assumption, not an API-enforced ceiling. Set provider-account budgets as well as local caps. Known token counts and actual query counts are recorded; estimates are labeled and reservations retained. Frozen studies freeze rate assumptions; reconcile actual billed charges when needed.

## Gate behavior

The gate requires sufficient grounded baseline/follow-up samples per provider, human review samples, nonempty accuracy denominators meeting the frozen thresholds, stable resolved models, terminal batches, acceptable failure/uncertain rates, acceptable cost without unknown charges, developer verification, resolved incident evidence, current provider dispositions/access, and evaluable citation domains.

Sample size thresholds are proposed starting values until the operator agrees them. Passing a small convenience sample does not prove population accuracy or causation. Owner decisions apply to the named study and evidence snapshot. They do not open registration, deploy anything, establish compliance, change entitlements, or automatically advance to Phase 3. The owner must separately review the multi-brand internal trial and Phase 1 prerequisites before authorizing private beta work.

## Release evidence still required

- Approved internal brands/domains and a fixed, documented branded/unbranded prompt library.
- Actual API response evidence from every provider to be admitted; blocked reasons for others.
- Actual human-labeled quality results at agreed thresholds and investigated false matches.
- Developer-verified website improvements and controlled follow-up observations.
- Invoice/cost analysis, staging worker reliability and incident-handling evidence.
- An explicit owner decision after those results are reviewed.

## Automated verification result

On 20 October 2026, all 62 automated checks passed with real PostgreSQL and Chromium enabled: zero failed and zero skipped. Coverage includes six provider contract fixtures, schema migration compatibility, controlled baseline/follow-up jobs, frozen configuration drift, human label corrections, tenant/role boundaries, blocked dispatch, cost reconciliation, provider approval revocation, owner decision staleness, isolated Search Suggestions, and desktop/mobile review workflows. Citation URL targets alone no longer inflate brand mentions.

No live provider requests, paid executions, owned-site improvements, staging deployment or real beta approval were performed. Docker build and deployed operations remain unverified locally because the Docker daemon is unavailable. Existing CI runs the expanded suite and container build when the branch is eventually pushed; no push was attempted for Phase 2.
