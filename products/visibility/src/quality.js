import { normalizedUrl, fingerprint, canonical } from "./providers.js";
import { summarize, cohorts, cohortKey } from "./metrics.js";
export function confusion(predicted, expected) {
  const p = new Set(predicted),
    e = new Set(expected);
  return {
    tp: [...p].filter((x) => e.has(x)).length,
    fp: [...p].filter((x) => !e.has(x)).length,
    fn: [...e].filter((x) => !p.has(x)).length,
  };
}
export function accuracy(counts) {
  const tp = counts.reduce((n, c) => n + c.tp, 0),
    fp = counts.reduce((n, c) => n + c.fp, 0),
    fn = counts.reduce((n, c) => n + c.fn, 0);
  return {
    tp,
    fp,
    fn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
  };
}
export function reviewResult(execution, expected) {
  return {
    citations: confusion(
      execution.citations.map((c) => normalizedUrl(c.url)).filter(Boolean),
      expected.citationUrls,
    ),
    mentions: confusion(
      (execution.mentions || [])
        .filter((m) => m.mentioned && !m.uncertain)
        .map((m) => m.domain),
      expected.mentionDomains,
    ),
  };
}
export function thresholds(input = {}) {
  const d = {
    minReviewedPerProvider: 3,
    minCompletedPerStage: 10,
    minPrecision: 0.95,
    minRecall: 0.95,
    maxFailureRate: 0.1,
    maxUncertainRate: 0.05,
    maxCostPer1000Usd: 50,
    ...input,
  };
  for (const k of ["minReviewedPerProvider", "minCompletedPerStage"])
    if (!Number.isInteger(d[k]) || d[k] < 1 || d[k] > 10000)
      throw new Error(`${k} must be 1–10000`);
  for (const k of [
    "minPrecision",
    "minRecall",
    "maxFailureRate",
    "maxUncertainRate",
  ])
    if (
      typeof d[k] !== "number" ||
      d[k] < 0 ||
      d[k] > 1 ||
      !Number.isFinite(d[k])
    )
      throw new Error(`${k} must be 0–1`);
  if (!Number.isFinite(d.maxCostPer1000Usd) || d.maxCostPer1000Usd <= 0)
    throw new Error("maxCostPer1000Usd must be positive");
  return Object.fromEntries(
    Object.keys({
      minReviewedPerProvider: 1,
      minCompletedPerStage: 1,
      minPrecision: 1,
      minRecall: 1,
      maxFailureRate: 1,
      maxUncertainRate: 1,
      maxCostPer1000Usd: 1,
    }).map((k) => [k, d[k]]),
  );
}
export function studyReport({
  study,
  batches,
  jobs,
  runs,
  reviews,
  usage,
  validations,
  providerChecks,
  catalog,
  envFingerprints,
  readyProviders = [],
}) {
  const latest = new Map();
  for (const review of reviews) latest.set(review.execution_id, review);
  const selected = runs.filter(
    (r) => r.data.status === "completed" && r.data.searched,
  );
  const sample = selected
    .slice()
    .sort((a, b) => fingerprint(a.id).localeCompare(fingerprint(b.id)));
  const providers = Object.keys(study.data.configurations).map((provider) => {
    const r = sample.filter((x) => x.data.provider === provider),
      labels = r.map((x) => latest.get(x.id)).filter(Boolean);
    const baseline = r.filter((x) => x.data.studyStage === "baseline"),
      followup = r.filter((x) => x.data.studyStage === "followup");
    const models = [...new Set(r.map((x) => x.data.model))];
    const providerUsage = usage.filter((u) => u.provider === provider);
    const committed = providerUsage.reduce(
      (n, u) => n + Number(u.actual_micros ?? u.reserved_micros),
      0,
    );
    return {
      provider,
      costPer1000Usd: r.length ? (committed / 1e6 / r.length) * 1000 : null,
      unknownCharges: providerUsage.filter(
        (u) => u.actual_micros === null && u.state !== "estimated_reserved",
      ).length,
      model: study.data.configurations[provider].model,
      resolvedModels: models,
      modelDrift: models.length > 1,
      baseline: summarize(
        baseline.map((x) => x.data),
        study.data.brand,
      ),
      followup: summarize(
        followup.map((x) => x.data),
        study.data.brand,
      ),
      reviewed: labels.length,
      citations: accuracy(labels.map((x) => x.data.result.citations)),
      mentions: accuracy(labels.map((x) => x.data.result.mentions)),
    };
  });
  const jobsFinished = jobs.filter(
    (j) => !["queued", "running"].includes(j.status),
  ).length;
  const failed = jobs.filter((j) =>
      ["failed", "uncertain", "cancelled"].includes(j.status),
    ).length,
    uncertain = jobs.filter((j) => j.status === "uncertain").length;
  const unknownUsage = usage.filter(
    (u) => u.actual_micros === null && u.state !== "estimated_reserved",
  );
  const accounted = usage.reduce(
    (n, u) => n + Number(u.actual_micros ?? u.reserved_micros),
    0,
  );
  const completed = selected.length;
  const cost = {
    attempts: usage.length,
    successfulExecutions: runs.filter((r) => r.data.status === "completed")
      .length,
    eligibleAnswers: completed,
    per1000AttemptsUsd: usage.length
      ? (accounted / 1e6 / usage.length) * 1000
      : null,
    per1000SuccessfulExecutionsUsd: runs.some(
      (r) => r.data.status === "completed",
    )
      ? (accounted /
          1e6 /
          runs.filter((r) => r.data.status === "completed").length) *
        1000
      : null,
    completed,
    providerReportedOrReconciledMicros: usage
      .filter((u) => ["settled", "reconciled"].includes(u.state))
      .reduce((n, u) => n + Number(u.actual_micros), 0),
    estimatedOrReservedMicros: usage
      .filter((u) => !["settled", "reconciled"].includes(u.state))
      .reduce((n, u) => n + Number(u.actual_micros ?? u.reserved_micros), 0),
    unknownCharges: unknownUsage.length,
    conservativeMicros: accounted,
    per1000Usd: completed ? (accounted / 1e6 / completed) * 1000 : null,
  };
  const dispositions = catalog.map((p) => {
    const c = providerChecks.filter((x) => x.provider === p.id).at(-1);
    return {
      provider: p.id,
      configurationFingerprint: c?.data.configurationFingerprint || null,
      status: !c
        ? "unreviewed"
        : c.data.status === "validated" &&
            c.data.configurationFingerprint !== envFingerprints[p.id]
          ? "stale"
          : c.data.status,
      notes: c?.data.notes || "",
      evidenceExecutionIds: c?.data.evidenceExecutionIds || [],
    };
  });
  const recommendations = validations.filter(
      (v) => v.kind === "recommendation",
    ),
    incidents = validations.filter((v) => v.kind === "incident");
  const t = study.data.thresholds,
    checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass, detail });
  check(
    "baseline_and_followup_samples",
    providers.length > 0 &&
      providers.every(
        (p) =>
          p.baseline.eligible >= t.minCompletedPerStage &&
          p.followup.eligible >= t.minCompletedPerStage,
      ),
    `At least ${t.minCompletedPerStage} eligible answers per provider in each stage`,
  );
  check(
    "manual_review_sample",
    providers.every((p) => p.reviewed >= t.minReviewedPerProvider),
    `At least ${t.minReviewedPerProvider} reviewed answers per provider`,
  );
  check(
    "citation_and_mention_accuracy",
    providers.every((p) =>
      ["citations", "mentions"].every(
        (k) =>
          p[k].precision !== null &&
          p[k].recall !== null &&
          p[k].precision >= t.minPrecision &&
          p[k].recall >= t.minRecall,
      ),
    ),
    `Precision ≥ ${t.minPrecision}; recall ≥ ${t.minRecall}; empty denominators are insufficient evidence`,
  );
  check(
    "model_consistency",
    providers.every((p) => !p.modelDrift),
    "Resolved model versions must remain consistent across baseline and follow-up",
  );
  check(
    "complete_batches",
    jobs.length > 0 && jobsFinished === jobs.length,
    "All planned study jobs have a terminal status",
  );
  check(
    "reliability",
    jobs.length > 0 &&
      failed / jobs.length <= t.maxFailureRate &&
      uncertain / jobs.length <= t.maxUncertainRate,
    `Failure rate ≤ ${t.maxFailureRate}; uncertain rate ≤ ${t.maxUncertainRate}`,
  );
  check(
    "cost",
    unknownUsage.length === 0 &&
      cost.per1000Usd !== null &&
      cost.per1000Usd <= t.maxCostPer1000Usd,
    `Known/estimated conservative cost ≤ $${t.maxCostPer1000Usd}/1,000; unknown charges must be reconciled`,
  );
  check(
    "recommendation_verified",
    recommendations.some((v) => v.data.verdict === "verified"),
    "At least one deployed technical improvement verified with developer evidence",
  );
  check(
    "incident_handling",
    incidents.some((v) => v.data.status === "resolved") &&
      !incidents.some((v) => v.data.status === "open"),
    "A resolved operational drill/incident and no open incidents",
  );
  check(
    "provider_dispositions",
    dispositions.every((p) => ["validated", "blocked"].includes(p.status)),
    "All six providers have a current validated or blocked disposition",
  );
  check(
    "studied_providers_validated",
    providers.every(
      (p) =>
        dispositions.find((d) => d.provider === p.provider)?.status ===
          "validated" &&
        dispositions.find((d) => d.provider === p.provider)
          ?.configurationFingerprint ===
          fingerprint(study.data.configurations[p.provider]),
    ),
    "Every provider measured in this study must have current live-validation evidence",
  );
  check(
    "citation_domain_coverage",
    providers.every(
      (p) =>
        p.baseline.unresolvedCitationResponses === 0 &&
        p.followup.unresolvedCitationResponses === 0,
    ),
    "Opaque citation redirects require investigation before release",
  );
  const matching = new Map();
  for (const r of runs) {
    const key = cohortKey(r.data);
    if (!matching.has(key))
      matching.set(key, {
        provider: r.data.provider,
        promptId: r.data.promptId,
        promptVersion: r.data.promptVersion,
        model: r.data.model,
        parameters: r.data.parameters,
        baseline: [],
        followup: [],
      });
    if (["baseline", "followup"].includes(r.data.studyStage))
      matching.get(key)[r.data.studyStage].push(r.data);
  }
  const matchedComparisons = [...matching.values()].map((g) => ({
    ...g,
    baseline: summarize(g.baseline, study.data.brand),
    followup: summarize(g.followup, study.data.brand),
  }));
  check(
    "prompt_mix_coverage",
    study.data.prompts.every((p) =>
      p.providers.every((provider) =>
        matchedComparisons.some(
          (c) =>
            c.provider === provider &&
            c.promptId === p.id &&
            c.promptVersion === p.version &&
            c.baseline.eligible > 0 &&
            c.followup.eligible > 0,
        ),
      ),
    ),
    "Every frozen prompt/provider pair must have eligible baseline and follow-up evidence in a matching cohort",
  );
  const durations = jobs
    .filter((j) => j.started_at && j.finished_at)
    .map((j) =>
      Math.max(0, Date.parse(j.finished_at) - Date.parse(j.started_at)),
    )
    .sort((a, b) => a - b);
  const durationStats = {
    completedTimedAttempts: durations.length,
    meanAttemptMs: durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null,
    p95AttemptMs: durations.length
      ? durations[Math.ceil(durations.length * 0.95) - 1]
      : null,
  };
  const evidenceFingerprint = fingerprint({
    jobs,
    runs: runs.map((r) => ({ id: r.id, data: { ...r.data, raw: undefined } })),
    reviews,
    usage,
    validations: validations.filter((v) => v.kind !== "decision"),
    providerChecks,
    envFingerprints,
    readyProviders,
  });
  check(
    "current_provider_access",
    providers.every((p) => readyProviders.includes(p.provider)),
    "Current credentials, pricing and access approval are required for studied providers",
  );
  const decision =
    validations.filter((v) => v.kind === "decision").at(-1) || null;
  return {
    evidenceFingerprint,
    study,
    batches,
    providers,
    matchedComparisons,
    cost,
    reliability: {
      ...durationStats,
      planned: jobs.length,
      finished: jobsFinished,
      failed,
      uncertain,
      failureRate: jobs.length ? failed / jobs.length : null,
      uncertainRate: jobs.length ? uncertain / jobs.length : null,
    },
    dispositions,
    quality: {
      reviewed: latest.size,
      reviewedSamples: sample
        .filter((r) => latest.has(r.id))
        .slice(0, 30)
        .map((r) => ({
          id: r.id,
          provider: r.data.provider,
          stage: r.data.studyStage,
          prompt: r.data.prompt,
          text: r.data.text,
          citations: r.data.citations,
          mentions: r.data.mentions,
        })),
      reviewQueue: sample
        .filter((r) => !latest.has(r.id))
        .slice(0, 30)
        .map((r) => ({
          id: r.id,
          provider: r.data.provider,
          stage: r.data.studyStage,
          prompt: r.data.prompt,
          text: r.data.text,
          citations: r.data.citations,
          mentions: r.data.mentions,
        })),
      method:
        "Deterministic SHA-256 ordering of execution IDs; manually labeled against raw evidence. Convenience sample, not a population estimate.",
    },
    cohorts: cohorts(runs, study.data.brand),
    validations,
    reviews,
    gate: {
      ready: checks.every((c) => c.pass),
      checks,
      decision,
      decisionSnapshotCurrent: decision
        ? decision.data.evidenceFingerprint === evidenceFingerprint
        : null,
    },
    methodology:
      "Internal controlled API samples. Frozen prompts/configurations and explicit stages. Compare matching cohorts; observed differences do not establish causation. Thresholds are frozen before baseline. Estimates and unknown costs are distinct. No automatic phase advancement.",
  };
}
