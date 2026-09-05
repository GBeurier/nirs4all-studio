// Iterative dataset builder (mode === "builder").
//
// app.js stays the decode / inference / viz / spec-form engine and exposes a
// small surface on window.NIRS4ALL_APP. This module drives the propose cycle:
// add files -> io.proposeDataset(files, records, {confirmed}) -> render the open
// decisions as confirmable cards -> on accept/override, push a lock and re-infer
// -> materialize a preview with io.assembleDataset. The one-shot view is untouched.

const APP = () => window.NIRS4ALL_APP;
const KIND_ORDER = ["structure", "role", "partition", "pairing", "identity", "signal_type", "task_type", "folds"];
const KIND_LABEL = {
  structure: "Structure",
  role: "Role",
  partition: "Partition",
  pairing: "Pairing",
  identity: "Identity",
  signal_type: "Signal",
  task_type: "Task",
  folds: "Folds",
};
const OVERRIDE_VOCAB = {
  role: ["features", "targets", "metadata", "weights", "ignore"],
  partition: ["train", "test", "val", "predict"],
  signal_type: ["absorbance", "reflectance", "reflectance%", "transmittance", "transmittance%", "kubelka-munk"],
  task_type: ["regression", "binary", "multiclass"],
};

let lastFileKey = "";

function state() {
  return APP().state;
}

function esc(s) {
  return APP().esc(s);
}

// --------------------------------------------------------------------------- //
// Propose cycle                                                               //
// --------------------------------------------------------------------------- //

async function runProposeCycle() {
  const app = APP();
  const s = state();
  s.builderError = null;
  const io = app.getIo();
  const { files, recordSets } = app.usableFilesForIo();

  if (!io?.proposeDataset || (!files.length && !recordSets.length)) {
    s.plan = null;
    s.proposals = [];
    s.confirmedEchoes = [];
    s.workingSpec = null;
    s.spec = null;
    s.assembled = null;
    app.setStatus(files.length || recordSets.length ? "Add a dataset to start the builder." : "Waiting for files.");
    app.renderAll();
    return;
  }

  let res;
  try {
    res = io.proposeDataset(files, recordSets, { confirmed: s.confirmed });
  } catch (err) {
    // Clear all derived state so a failed cycle never leaves a stale spec/preview.
    s.builderError = String(err?.message || err);
    s.plan = null;
    s.proposals = [];
    s.confirmedEchoes = [];
    s.workingSpec = null;
    s.spec = null;
    s.assembled = null;
    s.assembleError = null;
    s.validation = { ok: false, message: s.builderError };
    app.setStatus(`Inference failed: ${s.builderError}`);
    app.renderAll();
    return;
  }

  const proposals = Array.isArray(res.proposals) ? res.proposals : [];
  s.plan = res.plan || null;
  s.proposals = proposals.filter((p) => p.status === "proposed");
  s.confirmedEchoes = proposals.filter((p) => p.status !== "proposed");
  s.workingSpec = res.spec || app.defaultSpec();
  s.spec = s.workingSpec;
  s.validation = res.valid
    ? { ok: true, message: "spec is valid" }
    : { ok: false, message: (res.validation_errors || []).join("; ") || "spec is incomplete" };

  app.chooseDefaultSignal();
  app.chooseDefaultTarget();
  const view = app.datasetView();
  if (!s.userVizSelected && (view.targetValues.length || view.targetPreviewValues.length)) s.activeViz = "targets";

  pushStep();
  await materializePreview();
  app.setStatus(builderStatus());
  app.renderAll();
}

function pushStep() {
  const s = state();
  const names = s.files.map((f) => f.name);
  const key = names.join("|");
  const openCount = s.proposals.length;
  const confirmedCount = s.confirmedEchoes.length;
  const structure = s.plan?.structure?.value || "unknown";
  if (key === lastFileKey && s.steps.length) {
    const step = s.steps[s.steps.length - 1];
    step.openCount = openCount;
    step.confirmedCount = confirmedCount;
    step.structure = structure;
    return;
  }
  const prev = s.steps.length ? s.steps[s.steps.length - 1].names : [];
  const added = names.filter((n) => !prev.includes(n));
  s.steps.push({
    n: s.steps.length + 1,
    names,
    added: added.length ? added : names,
    openCount,
    confirmedCount,
    structure,
  });
  lastFileKey = key;
}

async function materializePreview() {
  const app = APP();
  const s = state();
  s.assembled = null;
  s.assembleError = null;
  const io = app.getIo();
  if (!io?.assembleDataset || !s.workingSpec) return;
  if (s.validation && !s.validation.ok) {
    s.assembleError = s.validation.message;
    return;
  }
  try {
    const { files, recordSets } = app.usableFilesForIo();
    // proposeDataset discovers sources from the file list (by name), so it needs
    // every file; assembleDataset instead resolves each spec `input` against the
    // union of files + record sets and rejects a name present in both. Drop the
    // raw bytes of any file already decoded into a record set (records win —
    // vendor formats can't be re-read from bytes) so each input resolves once.
    const decodedNames = new Set(recordSets.map((r) => r.source));
    const assembleFiles = files.filter((f) => !decodedNames.has(f.name));
    s.assembled = io.assembleDataset(assembleFiles, recordSets, JSON.stringify(s.workingSpec));
  } catch (err) {
    s.assembleError = String(err?.message || err);
  }
}

function builderStatus() {
  const s = state();
  const open = s.proposals.length;
  const structure = s.plan?.structure?.value || "unknown";
  if (s.builderError) return `Inference failed: ${s.builderError}`;
  if (!open) return `All decisions confirmed. Structure: ${structure}.`;
  return `${open} decision${open > 1 ? "s" : ""} to validate. Structure: ${structure}.`;
}

// --------------------------------------------------------------------------- //
// Confirm / override                                                          //
// --------------------------------------------------------------------------- //

function upsertConfirmed(lock) {
  const s = state();
  const idx = s.confirmed.findIndex((l) => l.kind === lock.kind && l.target === lock.target);
  if (idx >= 0) s.confirmed[idx] = lock;
  else s.confirmed.push(lock);
}

function removeConfirmed(kind, target) {
  const s = state();
  s.confirmed = s.confirmed.filter((l) => !(l.kind === kind && l.target === target));
}

function acceptAll() {
  const s = state();
  for (const p of s.proposals) {
    upsertConfirmed({ kind: p.kind, target: p.target, value: p.value, status: "confirmed" });
  }
  runProposeCycle();
}

// --------------------------------------------------------------------------- //
// Rendering                                                                   //
// --------------------------------------------------------------------------- //

function render() {
  if (state().mode !== "builder") return;
  renderProposals();
  renderSteps();
  renderDatasetSoFar();
  renderPreview();
}

function scoreClass(score) {
  if (score >= 0.75) return "ok";
  if (score >= 0.45) return "warn";
  return "";
}

function valueLabel(p) {
  const v = p.value;
  if (v && typeof v === "object") {
    if (v.mode === "join_id") return `join by id (${v.on || v.right_on || "shared key"})`;
    if (v.mode === "row_order") return "align by row order";
    if (v.mode === "concat_samples") return `stack ${(v.parts || []).length} files → ${v.whole || "y"}`;
    if (v.by) return v.key ? `by ${v.by} · ${v.key}` : `by ${v.by}`;
    return JSON.stringify(v);
  }
  return String(v);
}

function proposalCard(p) {
  const cls = scoreClass(p.score);
  const score = Number.isFinite(p.score) ? p.score.toFixed(2) : "-";
  const evidence = (p.evidence || []).join(" ");
  const alts = (p.alternatives || [])
    .map(
      (alt) =>
        `<button class="alt-chip" type="button" data-action="alt" data-id="${esc(p.id)}" data-alt='${esc(
          JSON.stringify(alt.value)
        )}'>${esc(valueLabel({ value: alt.value }))}<span class="alt-score">${(alt.score ?? 0).toFixed(2)}</span></button>`
    )
    .join("");
  const vocab = OVERRIDE_VOCAB[p.kind];
  const override = vocab
    ? `<label class="override">override
        <select data-action="override" data-id="${esc(p.id)}">
          ${["", ...vocab]
            .map(
              (opt) =>
                `<option value="${esc(opt)}"${opt === p.value ? " selected" : ""}>${opt || "pick…"}</option>`
            )
            .join("")}
        </select></label>`
    : "";
  return `
    <article class="proposal-card ${cls}${p.ambiguous ? " ambiguous" : ""}">
      <div class="proposal-head">
        <span class="proposal-title">${esc(KIND_LABEL[p.kind] || p.kind)} · <strong>${esc(p.target)}</strong></span>
        <span class="pill ${cls}">${score}${p.ambiguous ? " ?" : ""}</span>
      </div>
      <div class="proposal-value">${esc(valueLabel(p))}</div>
      ${evidence ? `<p class="proposal-why">${esc(evidence)}</p>` : ""}
      ${alts ? `<div class="proposal-alts">${alts}</div>` : ""}
      <div class="proposal-actions">
        ${override}
        <button class="primary compact" type="button" data-action="accept" data-id="${esc(p.id)}">Confirm</button>
      </div>
    </article>`;
}

function renderProposals() {
  const host = document.querySelector("#proposalGroups");
  const scoreBadge = document.querySelector("#builderScore");
  const s = state();
  if (scoreBadge) {
    const overall = s.plan?.overall_score;
    scoreBadge.textContent = Number.isFinite(overall) ? overall.toFixed(2) : "-";
    scoreBadge.className = `pill ${scoreClass(overall || 0)}`;
  }
  if (!host) return;

  if (s.builderError) {
    host.innerHTML = `<div class="empty err">${esc(s.builderError)}</div>`;
    return;
  }
  if (!s.proposals.length && !s.confirmedEchoes.length) {
    host.innerHTML = `<div class="empty">Add files to see decisions to validate.</div>`;
    return;
  }

  const byKind = new Map();
  for (const p of s.proposals) {
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }
  let html = "";
  for (const kind of KIND_ORDER) {
    const group = byKind.get(kind);
    if (!group || !group.length) continue;
    html += `<div class="proposal-group">
      <div class="proposal-group-title">${esc(KIND_LABEL[kind] || kind)}</div>
      ${group.map(proposalCard).join("")}
    </div>`;
  }
  if (!s.proposals.length) {
    html += `<div class="empty ok">All decisions confirmed — review the materialized preview below.</div>`;
  }
  if (s.confirmedEchoes.length) {
    html += `<details class="confirmed-list"><summary>Confirmed (${s.confirmedEchoes.length})</summary>
      ${s.confirmedEchoes
        .map(
          (p) =>
            `<div class="confirmed-row"><span>${esc(KIND_LABEL[p.kind] || p.kind)} · ${esc(p.target)} → ${esc(
              valueLabel(p)
            )}</span><button class="link" type="button" data-action="undo" data-kind="${esc(p.kind)}" data-target="${esc(
              p.target
            )}">undo</button></div>`
        )
        .join("")}
    </details>`;
  }
  host.innerHTML = html;
}

function renderSteps() {
  const host = document.querySelector("#stepList");
  if (!host) return;
  const s = state();
  if (!s.steps.length) {
    host.innerHTML = `<div class="empty">Each file you add becomes a step.</div>`;
    return;
  }
  host.innerHTML = s.steps
    .map((step) => {
      const done = step.openCount === 0;
      return `<div class="step-row ${done ? "done" : ""}">
        <span class="step">${step.n}</span>
        <div class="step-body">
          <div class="step-files">+ ${esc(step.added.join(", "))}</div>
          <div class="step-meta">${esc(step.structure)} · ${step.openCount} open · ${step.confirmedCount} confirmed</div>
        </div>
        <span class="pill ${done ? "ok" : "warn"}">${done ? "✓" : step.openCount}</span>
      </div>`;
    })
    .join("");
}

function renderDatasetSoFar() {
  const host = document.querySelector("#datasetSoFar");
  if (!host) return;
  const spec = state().workingSpec;
  const sources = spec?.sources || [];
  if (!sources.length) {
    host.innerHTML = `<div class="empty">No sources yet.</div>`;
    return;
  }
  const rows = sources
    .map((src) => {
      const role = src.role || "features";
      const part = src.partition ? `<span class="map-chip">${esc(src.partition)}</span>` : "";
      const join = src.join ? `<span class="map-chip join">⋈ ${esc(src.join.to || src.join.right || "")}</span>` : "";
      const input = Array.isArray(src.input) ? src.input.join(" + ") : src.input || src.id;
      return `<div class="sofar-row">
        <span class="role-tag role-${esc(role)}">${esc(role)}</span>
        <span class="sofar-name">${esc(input)}</span>${part}${join}
      </div>`;
    })
    .join("");
  const split = spec.partitions?.by ? `<div class="sofar-foot">split: ${esc(spec.partitions.by)}</div>` : "";
  const folds = spec.folds ? `<div class="sofar-foot">folds: yes</div>` : "";
  host.innerHTML = rows + split + folds;
}

function renderPreview() {
  const host = document.querySelector("#materializePreview");
  if (!host) return;
  const s = state();
  if (s.assembleError) {
    host.innerHTML = `<div class="empty warn">Not materializable yet: ${esc(s.assembleError)}</div>`;
    return;
  }
  const a = s.assembled;
  if (!a || !a.blocks) {
    host.innerHTML = `<div class="empty">Confirm the open decisions to preview the assembled dataset.</div>`;
    return;
  }
  const num = (n) => APP().fmtInt(Number(n));
  const blocks = Object.entries(a.blocks)
    .map(([part, block]) => {
      const xCols = (block.x || []).reduce((sum, m) => sum + (Number(m.n_cols) || 0), 0);
      const ySummary = block.y ? `y[${num(block.y.n_rows)}×${num(block.y.n_cols)}]` : "no y";
      const meta = block.metadata?.columns?.length ? ` · meta ${num(block.metadata.columns.length)}` : "";
      return `<div class="preview-block">
        <div class="preview-part">${esc(part)}</div>
        <div class="preview-stat"><strong>${num(block.n_samples)}</strong> samples</div>
        <div class="preview-stat">X[${num(block.n_samples)}×${num(xCols)}]</div>
        <div class="preview-stat">${esc(ySummary)}${esc(meta)}</div>
      </div>`;
    })
    .join("");
  const folds = (a.folds || []).length ? `<div class="preview-foot">${a.folds.length} fold(s)</div>` : "";
  host.innerHTML = blocks + folds;
}

// --------------------------------------------------------------------------- //
// Events                                                                      //
// --------------------------------------------------------------------------- //

function onProposalClick(event) {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const s = state();
  if (action === "accept" || action === "alt") {
    const p = s.proposals.find((x) => x.id === el.dataset.id);
    if (!p) return;
    let value = p.value;
    if (action === "alt") {
      try {
        value = JSON.parse(el.dataset.alt);
      } catch (_) {
        return;
      }
    }
    upsertConfirmed({ kind: p.kind, target: p.target, value, status: action === "alt" ? "overridden" : "confirmed" });
    runProposeCycle();
  } else if (action === "undo") {
    removeConfirmed(el.dataset.kind, el.dataset.target);
    runProposeCycle();
  }
}

function onProposalChange(event) {
  const el = event.target.closest('[data-action="override"]');
  if (!el || !el.value) return;
  const s = state();
  const p = s.proposals.find((x) => x.id === el.dataset.id);
  if (!p) return;
  upsertConfirmed({ kind: p.kind, target: p.target, value: el.value, status: "overridden" });
  runProposeCycle();
}

function wire() {
  document.querySelector("#proposalGroups")?.addEventListener("click", onProposalClick);
  document.querySelector("#proposalGroups")?.addEventListener("change", onProposalChange);
  document.querySelector("#acceptAll")?.addEventListener("click", acceptAll);
}

function resetBuilder() {
  lastFileKey = "";
  render();
}

function init() {
  window.NIRS4ALL_BUILDER = { runProposeCycle, render, reset: resetBuilder };
  wire();
  render();
  // If we loaded into builder mode with files already present (e.g. a future
  // default or a restored session), run the first propose cycle now.
  if (state().mode === "builder" && state().files.length) runProposeCycle();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
