import { validationUI } from "/validation.js";
const $ = (id) => document.getElementById(id);
let state,
  report,
  tenant = "",
  brand = "";
function node(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
}
function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").className = error ? "error" : "";
}
async function api(path, method = "GET", body) {
  const r = await fetch(`/api/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Visibility-Tenant": tenant,
      "Idempotency-Key": crypto.randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
function guard(fn) {
  return async (e) => {
    e?.preventDefault();
    try {
      await fn(e);
    } catch (err) {
      notice(err.message, true);
    }
  };
}
function button(label, fn) {
  const b = node("button", label, "quiet");
  b.type = "button";
  b.addEventListener("click", guard(fn));
  return b;
}
function link(url, label = url) {
  const a = node("a", label);
  try {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol)) return node("span", label);
    a.href = u.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  } catch {
    return node("span", label);
  }
}
function table(target, headers, rows) {
  const el = $(target);
  el.replaceChildren();
  if (!rows.length) {
    el.append(node("p", "No observations yet.", "empty"));
    return;
  }
  const t = node("table"),
    head = node("tr");
  headers.forEach((h) => head.append(node("th", h)));
  const thead = node("thead");
  thead.append(head);
  t.append(thead);
  const body = node("tbody");
  rows.forEach((row) => {
    const tr = node("tr");
    row.forEach((value) => {
      const td = node("td");
      td.append(value instanceof Node ? value : node("span", value ?? "—"));
      tr.append(td);
    });
    body.append(tr);
  });
  t.append(body);
  el.append(t);
}
function date(value) {
  return value ? new Date(value).toLocaleString() : "—";
}
function rate(value) {
  return value.rate === null
    ? "—"
    : `${(value.rate * 100).toFixed(1)}% (${value.numerator}/${value.denominator})`;
}
function selected() {
  return state?.brands.find((b) => b.id === brand);
}
function path(action) {
  if (!brand) throw new Error("Create or select a brand first");
  return `brands/${brand}/${action}`;
}
function options(select, items, value) {
  select.replaceChildren();
  for (const item of items) {
    const o = node("option", item.label);
    o.value = item.value;
    select.append(o);
  }
  if (value) select.value = value;
}
const validation = validationUI({
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
  getTenant: () => tenant,
  getBrand: () => brand,
  getState: () => state,
  getReport: () => report,
  refresh: () => refresh(),
});
async function loadReport() {
  if (!brand) {
    $("report-area").hidden = true;
    return;
  }
  if (report?.brand?.id !== brand) {
    $("evidence").hidden = true;
    $("evidence").textContent = "";
    $("evidence-suggestions").replaceChildren();
  }
  const q = new URLSearchParams();
  if ($("filter-provider").value) q.set("provider", $("filter-provider").value);
  if ($("filter-from").value) q.set("from", $("filter-from").value);
  if ($("filter-to").value) q.set("to", $("filter-to").value);
  report = await api(path(`report?${q}`));
  $("report-area").hidden = false;
  table(
    "cohorts",
    [
      "Provider / model",
      "Prompt / locale",
      "Mention rate",
      "Citation rate",
      "Share of voice",
      "Coverage",
      "Last observation",
    ],
    report.cohorts.map((c) => [
      `${c.provider} / ${c.model || "unknown"}`,
      `${String(c.promptId || "unknown").slice(0, 8)} v${c.promptVersion ?? "—"} · ${c.language}/${c.region}`,
      rate(c.mention),
      rate(c.citation),
      rate(c.shareOfVoice),
      `${c.eligible}/${c.planned} eligible`,
      date(c.lastRun),
    ]),
  );
  table(
    "trends",
    [
      "Date (UTC)",
      "Provider / model",
      "Prompt version",
      "Eligible / completed",
      "Mention rate",
      "Citation rate",
    ],
    report.cohorts.flatMap((c) =>
      c.daily.map((d) => [
        d.day,
        `${c.provider} / ${c.model}`,
        `${String(c.promptId || "unknown").slice(0, 8)} v${c.promptVersion ?? "—"}`,
        `${d.eligible}/${d.completed}`,
        rate(d.mention),
        rate(d.citation),
      ]),
    ),
  );
  const audit = report.audits[0];
  $("findings").replaceChildren();
  $("finding-select").replaceChildren();
  $("audit-method").textContent = audit
    ? `${date(audit.observed_at)} · ${audit.data.methodology} Render visibility: ${audit.data.renderVisibility}. ${audit.data.partial ? "Partial audit." : ""}`
    : "Run an audit to collect URL-level evidence.";
  if (audit) {
    const all = [
      ...(audit.data.findings || []),
      ...audit.data.pages.flatMap((p) => p.findings || []),
    ];
    all.forEach((f, i) => {
      const div = node("div", undefined, "finding");
      div.append(
        node("span", f.severity, "severity"),
        node("strong", f.code.replaceAll("_", " ")),
        link(f.url),
        node("p", `Evidence: ${f.evidence}`),
        node("p", `Action: ${f.remediation}`),
        node("p", `Verify: ${f.verification}`, "muted"),
      );
      $("findings").append(div);
      const o = node("option", `${f.code}: ${f.url}`);
      o.value = `${audit.id}:${i}`;
      $("finding-select").append(o);
    });
    for (const p of audit.data.pages) {
      const d = node("details");
      d.append(
        node("summary", `Page evidence: ${p.url}`),
        node("pre", JSON.stringify(p, null, 2)),
      );
      $("findings").append(d);
    }
  }
  table(
    "changes",
    ["Deployed", "Change", "Evidence", "Later observations"],
    report.changes.map((c) => [
      date(c.data.deployedAt),
      c.data.description,
      link(c.data.link, "View change"),
      report.runs.filter(
        (r) =>
          new Date(r.observed_at) > new Date(c.data.deployedAt) &&
          r.data.status === "completed",
      ).length,
    ]),
  );
  table(
    "comparisons",
    [
      "Deployment",
      "Matching cohort",
      "Before mention / citation",
      "After mention / citation",
    ],
    report.comparisons.flatMap((c) =>
      c.cohorts.map((g) => [
        date(c.deployedAt),
        `${g.configuration.provider} / ${g.configuration.model} · v${g.configuration.promptVersion ?? "—"}`,
        `${rate(g.before.mention)} / ${rate(g.before.citation)}`,
        `${rate(g.after.mention)} / ${rate(g.after.citation)}`,
      ]),
    ),
  );
  table(
    "runs",
    ["Observed", "Provider / model", "Status", "Citations", "Evidence"],
    report.runs
      .slice()
      .reverse()
      .map((r) => {
        const citations = node("div");
        for (const c of r.data.citations || []) {
          citations.append(link(c.url, c.title || c.url), node("br"));
        }
        return [
          date(r.observed_at),
          `${r.data.provider} / ${r.data.model || "unknown"}`,
          r.data.status,
          citations,
          button("Inspect", async () => {
            const raw = await api(path(`evidence/${r.id}`));
            $("evidence").textContent = JSON.stringify(raw, null, 2);
            $("evidence-suggestions").replaceChildren();
            if (
              raw.provider === "gemini" &&
              raw.providerMetadata?.searchSuggestions
            ) {
              const frame = node("iframe");
              frame.title = "Google Search Suggestions";
              frame.src = `/api/search-suggestions?${new URLSearchParams({ tenant, brand, execution: r.id })}`;
              frame.setAttribute(
                "sandbox",
                "allow-popups allow-popups-to-escape-sandbox",
              );
              $("evidence-suggestions").append(frame);
            }
            $("evidence").hidden = false;
            $("evidence").focus();
          }),
        ];
      }),
  );
  table(
    "referrals",
    ["Date", "Source", "Classification", "Visits"],
    report.referrals.map((r) => [
      r.data.date,
      r.data.source,
      r.data.classification,
      r.data.count,
    ]),
  );
}
async function refresh() {
  state = await api("state");
  options(
    $("brand"),
    state.brands.map((b) => ({ value: b.id, label: b.data.name })),
    brand,
  );
  brand = $("brand").value;
  $("budget").replaceChildren(
    node("span", "MONTHLY SPEND COMMITTED", "eyebrow"),
    node(
      "h2",
      `$${(Number(state.budget.committed_micros) / 1e6).toFixed(2)} / $${(Number(state.budget.monthly_cap_micros) / 1e6).toFixed(2)}`,
    ),
    node("small", "Includes reservations and uncertain charges."),
  );
  $("providers").replaceChildren();
  $("prompt-providers").replaceChildren();
  for (const p of state.providers) {
    const card = node("div", undefined, "provider"),
      title = node("b"),
      dot = node("span", undefined, `dot ${p.ready ? "ready" : ""}`);
    title.append(dot, document.createTextNode(p.name));
    card.append(
      title,
      node("small", p.status),
      node("small", p.model || "No model configured"),
    );
    $("providers").append(card);
    const label = node("label"),
      check = node("input");
    check.type = "checkbox";
    check.name = "provider";
    check.value = p.id;
    check.disabled = !p.ready;
    label.append(check, document.createTextNode(p.name));
    $("prompt-providers").append(label);
  }
  const previous = $("filter-provider").value;
  options(
    $("filter-provider"),
    [
      { value: "", label: "All providers" },
      ...state.providers.map((p) => ({ value: p.id, label: p.name })),
    ],
    previous,
  );
  table(
    "prompts",
    [
      "Question",
      "Version / locale",
      "Providers",
      "Schedule",
      "State",
      "Actions",
    ],
    state.prompts
      .filter((p) => p.brand_id === brand)
      .map((p) => {
        const actions = node("div");
        if (state.role !== "MEMBER") {
          actions.append(
            button(p.active ? "Pause" : "Activate", async () => {
              await api(path(`prompts/${p.id}`), "PUT", { active: !p.active });
              await refresh();
            }),
            button("Edit", () => {
              const f = $("prompt-form");
              f.elements.id.value = p.id;
              for (const name of ["text", "category", "language", "region"])
                f.elements[name].value = p.data[name];
              f.elements.intervalMinutes.value = p.interval_minutes || "";
              for (const check of document.querySelectorAll("[name=provider]"))
                check.checked = p.data.providers.includes(check.value);
              f.scrollIntoView({ behavior: "smooth" });
            }),
          );
        }
        return [
          p.data.text,
          `v${p.version} · ${p.data.language}/${p.data.region}`,
          p.data.providers.join(", "),
          p.interval_minutes ? `${p.interval_minutes} min` : "Manual",
          p.active ? "Active" : "Paused",
          actions,
        ];
      }),
  );
  table(
    "jobs",
    ["Created", "Type", "Status", "Attempts", "Details"],
    state.jobs.map((j) => [
      date(j.created_at),
      j.kind,
      j.status,
      j.attempts,
      j.error || "—",
    ]),
  );
  table(
    "usage",
    ["When", "Provider", "State", "Reserved USD", "Accounted USD", "Job"],
    state.usage.map((u) => [
      date(u.created_at),
      u.provider,
      u.state,
      (Number(u.reserved_micros) / 1e6).toFixed(4),
      u.actual_micros === null
        ? "Unknown / reservation retained"
        : (Number(u.actual_micros) / 1e6).toFixed(4),
      u.job_id.slice(0, 8),
    ]),
  );
  table(
    "events",
    ["When", "Action", "Details"],
    state.events.map((e) => [
      date(e.created_at),
      e.action,
      JSON.stringify(e.data),
    ]),
  );
  document
    .querySelectorAll(".admin")
    .forEach((el) => (el.hidden = state.role === "MEMBER"));
  for (const id of ["audit", "run"])
    $(id).disabled = !brand || state.role === "MEMBER";
  $("export").disabled = !brand;
  await loadReport();
  await validation.load();
}
async function init() {
  const me = await api("me");
  $("login-panel").hidden = true;
  $("workspace").hidden = false;
  $("account").hidden = false;
  options(
    $("tenant"),
    me.tenants.map((t) => ({ value: t.id, label: t.name })),
    tenant,
  );
  tenant = $("tenant").value;
  if (!tenant)
    throw new Error("No organization membership; contact your administrator");
  await refresh();
}
$("login").addEventListener(
  "submit",
  guard(async () => {
    await api("login", "POST", Object.fromEntries(new FormData($("login"))));
    $("login").reset();
    notice("");
    await init();
  }),
);
$("logout").addEventListener(
  "click",
  guard(async () => {
    await api("logout", "POST", {});
    location.reload();
  }),
);
$("tenant").addEventListener(
  "change",
  guard(async () => {
    tenant = $("tenant").value;
    brand = "";
    await refresh();
  }),
);
$("brand").addEventListener(
  "change",
  guard(async () => {
    brand = $("brand").value;
    await refresh();
  }),
);
$("refresh").addEventListener("click", guard(refresh));
$("filter").addEventListener("click", guard(loadReport));
for (const id of ["audit", "run"])
  $(id).addEventListener(
    "click",
    guard(async () => {
      await api(path(id), "POST", {});
      notice(
        `${id === "audit" ? "Audit" : "Monitoring"} queued. The worker processes jobs independently.`,
      );
      await refresh();
    }),
  );
$("brand-form").addEventListener(
  "submit",
  guard(async () => {
    const f = $("brand-form"),
      d = Object.fromEntries(new FormData(f)),
      id = d.id;
    delete d.id;
    for (const k of ["aliases", "ambiguousAliases", "canonicalUrls"])
      d[k] = d[k]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    d.competitors = JSON.parse(d.competitors || "[]");
    const r = await api(id ? `brands/${id}` : "brands", id ? "PUT" : "POST", d);
    brand = id || r.id;
    f.reset();
    await refresh();
    notice("Brand saved.");
  }),
);
$("edit-brand").addEventListener(
  "click",
  guard(() => {
    const b = selected();
    if (!b) throw new Error("Select a brand");
    const f = $("brand-form");
    f.elements.id.value = b.id;
    for (const k of ["name", "domain", "language", "region"])
      f.elements[k].value = b.data[k];
    for (const k of ["aliases", "ambiguousAliases", "canonicalUrls"])
      f.elements[k].value = (b.data[k] || []).join(", ");
    f.elements.competitors.value = JSON.stringify(b.data.competitors, null, 2);
  }),
);
$("prompt-form").addEventListener(
  "submit",
  guard(async () => {
    const f = $("prompt-form"),
      d = Object.fromEntries(new FormData(f));
    const id = d.id;
    delete d.id;
    delete d.provider;
    d.providers = [...document.querySelectorAll("[name=provider]:checked")].map(
      (c) => c.value,
    );
    d.intervalMinutes = d.intervalMinutes ? Number(d.intervalMinutes) : null;
    await api(path(id ? `prompts/${id}` : "prompts"), id ? "PUT" : "POST", d);
    f.reset();
    await refresh();
    notice("Prompt saved with an immutable version.");
  }),
);
$("import-form").addEventListener(
  "submit",
  guard(async () => {
    await api(path("prompts"), "POST", {
      prompts: JSON.parse($("import-form").elements.prompts.value),
    });
    $("import-form").reset();
    await refresh();
    notice("Prompt set imported.");
  }),
);
$("change-form").addEventListener(
  "submit",
  guard(async () => {
    const d = Object.fromEntries(new FormData($("change-form")));
    d.deployedAt = new Date(d.deployedAt).toISOString();
    await api(path("changes"), "POST", d);
    $("change-form").reset();
    await refresh();
    notice("Deployed change recorded.");
  }),
);
$("referral-form").addEventListener(
  "submit",
  guard(async () => {
    const d = Object.fromEntries(new FormData($("referral-form")));
    d.rows = JSON.parse(d.rows);
    await api(path("referrals"), "POST", d);
    $("referral-form").reset();
    await refresh();
    notice("Referral data imported.");
  }),
);
$("export").addEventListener(
  "click",
  guard(async () => {
    const r = await fetch(
      `/api/${path(`report.csv?${new URLSearchParams({ provider: $("filter-provider").value, from: $("filter-from").value, to: $("filter-to").value })}`)}`,
      {
        headers: {
          "X-Visibility-Tenant": tenant,
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
    );
    if (!r.ok) throw new Error("Export failed");
    const url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = "flocca-visibility.csv";
    a.click();
    URL.revokeObjectURL(url);
  }),
);
init().catch((e) => {
  if (e.message !== "Sign in required") notice(e.message, true);
});
