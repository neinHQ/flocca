export function validationUI({
  api,
  path,
  node,
  button,
  table,
  options,
  date,
  rate,
  guard,
  notice,
  getTenant,
  getBrand,
  getState,
  getReport,
  refresh,
}) {
  const $ = (id) => document.getElementById(id);
  let detailRevision = 0;
  let active = "",
    current = null,
    scope = "";
  const split = (value) =>
    value
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  const studyPath = (action) => {
    if (!active) throw new Error("Select a study first");
    return path(`studies/${active}${action ? "/" + action : ""}`);
  };
  async function inspect(r) {
    const evidence = await api(path(`evidence/${r.id}`));
    $("study-raw").hidden = false;
    $("study-raw").textContent = JSON.stringify(
      { provider: evidence.provider, model: evidence.model, raw: evidence.raw },
      null,
      2,
    );
    $("study-raw").focus();
    $("study-suggestions").replaceChildren();
    if (
      evidence.provider === "gemini" &&
      evidence.providerMetadata?.searchSuggestions
    ) {
      const frame = node("iframe");
      frame.title = "Google Search Suggestions";
      frame.src = `/api/search-suggestions?${new URLSearchParams({ tenant: getTenant(), brand: getBrand(), execution: r.id })}`;
      frame.setAttribute(
        "sandbox",
        "allow-popups allow-popups-to-escape-sandbox",
      );
      $("study-suggestions").append(frame);
    }
  }
  async function detail() {
    if (!active) {
      $("study-detail").hidden = true;
      return;
    }
    const revision = ++detailRevision,
      selectedId = active,
      selectedScope = scope;
    const result = await api(studyPath(""));
    if (
      revision !== detailRevision ||
      selectedId !== active ||
      selectedScope !== scope
    )
      return;
    current = result;
    $("study-detail").hidden = false;
    $("study-status").textContent =
      `${current.gate.ready ? "Evidence checks passed; owner decision required." : "Evidence checks incomplete."} ${current.gate.decision ? `Last decision: ${current.gate.decision.data.outcome} (${current.gate.decisionSnapshotCurrent ? "current snapshot" : "evidence changed since decision"}).` : ""}`;
    $("study-manifest").textContent = JSON.stringify(
      current.study.data,
      null,
      2,
    );
    $("study-operations").textContent = JSON.stringify(
      { cost: current.cost, reliability: current.reliability },
      null,
      2,
    );
    $("study-sampling").textContent = current.quality.method;
    table(
      "study-gates",
      ["Check", "Result", "Evidence required"],
      current.gate.checks.map((c) => [
        c.name.replaceAll("_", " "),
        c.pass ? "Pass" : "Pending",
        c.detail,
      ]),
    );
    const score = (n) =>
      n === null ? "Insufficient labels" : `${(n * 100).toFixed(1)}%`;
    table(
      "study-quality",
      [
        "Provider",
        "Reviewed",
        "Citation precision / recall",
        "Mention precision / recall",
        "False positives / negatives",
        "Model drift",
        "Conservative USD / 1,000",
      ],
      current.providers.map((p) => [
        p.provider,
        p.reviewed,
        `${score(p.citations.precision)} / ${score(p.citations.recall)}`,
        `${score(p.mentions.precision)} / ${score(p.mentions.recall)}`,
        `Citations ${p.citations.fp}/${p.citations.fn}; mentions ${p.mentions.fp}/${p.mentions.fn}`,
        p.modelDrift ? "Detected" : "None observed",
        p.costPer1000Usd === null
          ? "—"
          : `$${p.costPer1000Usd.toFixed(2)} (${p.unknownCharges} unknown charges)`,
      ]),
    );
    table(
      "study-comparisons",
      [
        "Provider / prompt",
        "Baseline n / mention / citation",
        "Follow-up n / mention / citation",
      ],
      (current.matchedComparisons || []).map((c) => [
        `${c.provider} / ${c.promptId.slice(0, 8)} v${c.promptVersion}`,
        `${c.baseline.eligible} / ${rate(c.baseline.mention)} / ${rate(c.baseline.citation)}`,
        `${c.followup.eligible} / ${rate(c.followup.mention)} / ${rate(c.followup.citation)}`,
      ]),
    );
    table(
      "study-review-queue",
      ["Execution", "Provider / stage", "Prompt", "Review"],
      [
        ...current.quality.reviewQueue,
        ...($("study-show-reviewed").checked
          ? current.quality.reviewedSamples
          : []),
      ].map((r) => {
        const actions = node("div");
        actions.append(button("Inspect raw", () => inspect(r)));
        if (getState().role !== "MEMBER")
          actions.append(
            button("Label", async () => {
              await inspect(r);
              const f = $("study-review");
              f.reset();
              f.elements.executionId.value = r.id;
              f.hidden = false;
            }),
          );
        return [r.id, `${r.provider} / ${r.stage}`, r.prompt, actions];
      }),
    );
    const changes = getReport()?.changes || [];
    $("study-change-list").replaceChildren();
    for (const c of changes) {
      const label = node("label"),
        check = node("input");
      check.type = "checkbox";
      check.name = "changeId";
      check.value = c.id;
      label.append(
        check,
        document.createTextNode(
          `${date(c.data.deployedAt)} · ${c.data.description}`,
        ),
      );
      $("study-change-list").append(label);
    }
    options(
      $("study-recommendation-change"),
      changes.map((c) => ({ value: c.id, label: c.data.description })),
    );
    options($("study-incident-id"), [
      { value: "", label: "New incident" },
      ...current.validations
        .filter((v) => v.kind === "incident")
        .map((v) => ({
          value: v.id,
          label: `${v.data.scenario} (${v.data.status})`,
        })),
    ]);
    $("study-approve").disabled = !current.gate.ready;
  }
  async function load() {
    const state = getState(),
      brand = getBrand();
    $("validation-panel").hidden = !brand;
    const nextScope = `${getTenant()}:${brand}`;
    if (scope !== nextScope) {
      active = "";
      current = null;
      scope = nextScope;
      $("study-review").hidden = true;
      $("study-raw").hidden = true;
      $("study-suggestions").replaceChildren();
    }
    options(
      $("provider-check-provider"),
      state.providers.map((p) => ({ value: p.id, label: p.name })),
    );
    options(
      $("reconcile-usage"),
      state.usage.map((u) => ({
        value: u.id,
        label: `${u.provider} · ${u.state} · ${u.id}`,
      })),
    );
    document
      .querySelectorAll(".owner")
      .forEach((el) => (el.hidden = state.role !== "OWNER"));
    if (!brand) return;
    $("study-prompts").replaceChildren();
    for (const p of state.prompts.filter((p) => p.brand_id === brand)) {
      const label = node("label"),
        check = node("input");
      check.type = "checkbox";
      check.value = p.id;
      check.name = "promptId";
      label.append(
        check,
        document.createTextNode(`${p.data.text} · v${p.version}`),
      );
      $("study-prompts").append(label);
    }
    const list = await api(path("studies"));
    if (!list.studies.some((s) => s.id === active))
      active = list.studies[0]?.id || "";
    options(
      $("study-select"),
      list.studies.map((s) => ({ value: s.id, label: s.data.name })),
      active,
    );
    await detail();
  }
  $("study-show-reviewed").addEventListener("change", guard(detail));
  $("study-select").addEventListener(
    "change",
    guard(async () => {
      active = $("study-select").value;
      $("study-review").hidden = true;
      $("study-raw").hidden = true;
      $("study-suggestions").replaceChildren();
      await detail();
    }),
  );
  $("study-refresh").addEventListener("click", guard(detail));
  $("study-create").addEventListener(
    "submit",
    guard(async () => {
      const data = Object.fromEntries(new FormData($("study-create")));
      const thresholds = {};
      for (const [k, v] of Object.entries(data))
        if (!["name", "promptId"].includes(k)) thresholds[k] = Number(v);
      const r = await api(path("studies"), "POST", {
        name: data.name,
        thresholds,
        promptIds: [
          ...document.querySelectorAll("#study-prompts input:checked"),
        ].map((c) => c.value),
      });
      active = r.id;
      await load();
      notice("Study manifest frozen. Baseline can now be queued.");
    }),
  );
  $("study-batch").addEventListener(
    "submit",
    guard(async () => {
      const d = Object.fromEntries(new FormData($("study-batch")));
      await api(studyPath("batches"), "POST", {
        stage: d.stage,
        repetitions: Number(d.repetitions),
        changeIds: [
          ...document.querySelectorAll("#study-change-list input:checked"),
        ].map((c) => c.value),
      });
      await refresh();
      notice("Controlled batch queued with frozen settings.");
    }),
  );
  $("study-review").addEventListener(
    "submit",
    guard(async () => {
      const f = $("study-review"),
        d = Object.fromEntries(new FormData(f));
      await api(studyPath(`reviews/${d.executionId}`), "POST", {
        citationUrls: split(d.citationUrls),
        mentionDomains: split(d.mentionDomains),
        notes: d.notes,
        reviewedRaw: f.elements.reviewedRaw.checked,
      });
      f.hidden = true;
      await detail();
      notice("Human extraction labels recorded.");
    }),
  );
  for (const [form, route] of [
    ["study-recommendation", "recommendations"],
    ["study-incident", "incidents"],
    ["study-decision", "decision"],
  ])
    $(form).addEventListener(
      "submit",
      guard(async () => {
        const d = Object.fromEntries(new FormData($(form)));
        if (!d.incidentId) delete d.incidentId;
        await api(studyPath(route), "POST", d);
        $(form).reset();
        await detail();
        notice("Validation evidence recorded.");
      }),
    );
  $("provider-check").addEventListener(
    "submit",
    guard(async () => {
      const d = Object.fromEntries(new FormData($("provider-check")));
      d.evidenceExecutionIds = split(d.evidenceExecutionIds);
      await api("provider-checks", "POST", d);
      await refresh();
      notice("Provider disposition recorded.");
    }),
  );
  $("usage-reconcile").addEventListener(
    "submit",
    guard(async () => {
      const d = Object.fromEntries(new FormData($("usage-reconcile")));
      await api(`usage/${d.usageId}/reconcile`, "POST", {
        actualUsd: Number(d.actualUsd),
        evidenceUrl: d.evidenceUrl,
        notes: d.notes,
      });
      await refresh();
      notice("Actual usage reconciled with billing evidence.");
    }),
  );
  $("study-export").addEventListener(
    "click",
    guard(async () => {
      const r = await fetch(`/api/${studyPath("report.csv")}`, {
        headers: { "X-Visibility-Tenant": getTenant() },
      });
      if (!r.ok) throw new Error("Study export failed");
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = "flocca-validation.csv";
      a.click();
      URL.revokeObjectURL(url);
    }),
  );
  return { load };
}
