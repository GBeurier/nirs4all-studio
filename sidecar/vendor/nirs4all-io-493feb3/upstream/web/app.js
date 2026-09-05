let formats = null;
let io = null;

const state = {
  files: [],
  decoded: [],
  plan: null,
  spec: null,
  activeViz: "spectra",
  activeSignal: "",
  activeTarget: "",
  colorBy: "target",
  sampleLimit: 180,
  validation: null,
  userVizSelected: false,
  // The one-shot view (mode === "oneshot") is the landing experience, unchanged;
  // the iterative builder (mode === "builder") is the prominent toggle.
  mode: "oneshot",
  confirmed: [],
  proposals: [],
  confirmedEchoes: [],
  steps: [],
  workingSpec: null,
  assembled: null,
  assembleError: null,
  builderError: null,
};

const PALETTE = ["#0d9488", "#06b6d4", "#4f46e5", "#d97706", "#10b981", "#e11d48", "#7c3aed", "#0891b2"];
const SOURCE_ROLES = ["features", "targets", "metadata", "weights", "ignore", "mixed"];
const SOURCE_KINDS = ["table", "lookup"];
const SOURCE_MODALITIES = ["", "spectroscopy", "markers", "metadata", "image"];
const MERGE_MODES = ["", "concat_samples", "concat_features", "by_key", "none"];
const PARTITIONS = ["", "train", "test", "val", "predict", "auto"];
const PARTITION_BY = ["", "files", "column", "index", "index_file"];
const UNKNOWN_POLICIES = ["train", "test", "drop", "error"];
const JOIN_CARDINALITIES = ["1:1", "m:1", "1:m"];
const JOIN_COVERAGE = ["complete", "warn", "drop", "error"];
const SIGNAL_TYPES = ["auto", "absorbance", "reflectance", "reflectance%", "transmittance", "transmittance%", "log(1/R)", "kubelka-munk"];
const HEADER_UNITS = ["", "nm", "cm-1", "none", "text", "index"];
const AGGREGATE_METHODS = ["", "mean", "median", "vote", "robust_mean"];
const FOLD_FORMATS = ["auto", "csv", "json", "yaml", "txt"];
const NA_POLICIES = ["auto", "abort", "remove_sample", "remove_feature", "replace", "ignore"];
const CATEGORICAL_MODES = ["", "auto", "preserve", "none"];
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtInt = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "-";
const fmtNum = (n, d = 4) => Number.isFinite(n) ? Number(n.toPrecision(d)).toString() : "-";
const baseName = (name) => String(name || "").replace(/\\/g, "/").split("/").pop();
const dirName = (name) => {
  const s = String(name || "").replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(0, i + 1) : "";
};
const extOf = (name) => {
  const m = /\.([^.\\/]+)$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
};

boot();

// Shared seam consumed by builder.js (the iterative-builder module). app.js stays
// the decode/inference/viz/spec-form engine; builder.js drives the propose cycle
// and the builder-only panels through this surface.
function exposeApp() {
  window.NIRS4ALL_APP = {
    state,
    getIo: () => io,
    usableFilesForIo,
    recordSetsForIo,
    renderAll,
    drawViz,
    datasetView,
    chooseDefaultSignal,
    chooseDefaultTarget,
    defaultSpec,
    setStatus,
    esc,
    fmtInt,
    fmtNum,
    vocab: { SOURCE_ROLES, PARTITIONS, SIGNAL_TYPES, TASK_TYPES: ["auto", "regression", "binary", "multiclass"] },
  };
}

function setMode(mode) {
  if (mode !== "builder" && mode !== "oneshot") return;
  state.mode = mode;
  document.body.classList.toggle("mode-builder", mode === "builder");
  document.body.classList.toggle("mode-oneshot", mode === "oneshot");
  $$("#modeToggle [data-mode]").forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  if (state.files.length) recompute();
  else renderAll();
}

function usableFilesForIo() {
  const usableFiles = state.files.filter((file) => !isInferenceExcluded(file));
  return {
    files: usableFiles.map((f) => ({ name: f.name, bytes: f.bytes })),
    recordSets: recordSetsForIo(),
  };
}

async function boot() {
  exposeApp();
  wireUi();
  document.body.classList.add(state.mode === "builder" ? "mode-builder" : "mode-oneshot");
  renderAll();
  try {
    const [fmtMod, ioMod] = await loadWasmModules();
    formats = fmtMod;
    io = ioMod;
    $("#runtime").textContent = runtimeLabel(formats, io);
    $("#runtime").title = runtimeTitle(formats, io);
    $("#runtime").className = "runtime ok";
    setStatus("WASM ready. Add files to build a dataset.");
  } catch (err) {
    $("#runtime").textContent = "wasm bundle missing";
    $("#runtime").className = "runtime err";
    setStatus(`WASM could not be loaded: ${err.message || err}. Run ./build-wasm.sh in web/.`);
  }
}

async function loadWasmModules() {
  if (typeof window !== "undefined" && window.NIRS4ALL_STANDALONE?.loadWasmModules) {
    return window.NIRS4ALL_STANDALONE.loadWasmModules();
  }
  const [fmtMod, ioMod] = await Promise.all([
    import("./pkg/formats/nirs4all_formats_wasm.js"),
    import("./pkg/io/nirs4all_io_wasm.js"),
  ]);
  await Promise.all([fmtMod.default(), ioMod.default()]);
  return [fmtMod, ioMod];
}

function safeVersion(mod) {
  try { return mod.version(); } catch (_) { return "?"; }
}

function runtimeLabel(formatsMod, ioMod) {
  const features = formatFeatures(formatsMod);
  const scope = features?.hdf5 && features?.matlab && features?.parquet ? "all readers" : featureList(features);
  return `formats ${safeVersion(formatsMod)} · ${scope || "runtime"} / io ${safeVersion(ioMod)}`;
}

function runtimeTitle(formatsMod, ioMod) {
  const features = formatFeatures(formatsMod);
  const parts = [];
  if (features?.hdf5) parts.push("HDF5/NetCDF");
  if (features?.matlab) parts.push("MATLAB/RData");
  if (features?.parquet) parts.push("Parquet");
  const scope = parts.length ? parts.join(", ") : "base readers";
  return `nirs4all-formats ${safeVersion(formatsMod)} (${scope}); nirs4all-io ${safeVersion(ioMod)}`;
}

function formatFeatures(formatsMod) {
  try { return formatsMod.features?.() || null; } catch (_) { return null; }
}

function featureList(features) {
  if (!features) return "";
  return Object.entries(features)
    .filter(([, on]) => on)
    .map(([key]) => key)
    .join("/");
}

function wireUi() {
  $("#pick").addEventListener("click", () => $("#fileInput").click());
  $("#pickFolder").addEventListener("click", () => $("#folderInput").click());
  $("#fileInput").addEventListener("change", async (event) => {
    await addFiles([...event.target.files]);
    event.target.value = "";
  });
  $("#folderInput").addEventListener("change", async (event) => {
    await addFiles([...event.target.files]);
    event.target.value = "";
  });
  $("#loadSample").addEventListener("click", loadSampleDataset);
  $("#reset").addEventListener("click", reset);
  $("#modeToggle")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-mode]");
    if (btn) setMode(btn.dataset.mode);
  });
  $("#resetSpec").addEventListener("click", resetSpecToInferred);
  $("#copySpec").addEventListener("click", copySpecJson);
  $("#downloadSpec").addEventListener("click", downloadSpecJson);
  $("#datasetAlerts").addEventListener("click", (event) => {
    if (event.target.closest("[data-add-sidecars]")) $("#fileInput").click();
  });
  $("#signalSelect").addEventListener("change", (event) => {
    state.activeSignal = event.target.value;
    drawViz();
  });
  $("#targetSelect").addEventListener("change", (event) => {
    state.activeTarget = event.target.value;
    state.activeViz = "targets";
    state.userVizSelected = true;
    renderKpis();
    renderVizTabs();
    drawViz();
  });
  $("#colorSelect").addEventListener("change", (event) => {
    state.colorBy = event.target.value;
    drawViz();
  });
  $("#sampleLimit").addEventListener("input", (event) => {
    state.sampleLimit = Number(event.target.value);
    drawViz();
  });
  $("#vizTabs").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-viz]");
    if (!btn) return;
    state.activeViz = btn.dataset.viz;
    state.userVizSelected = true;
    renderVizTabs();
    drawViz();
  });

  let depth = 0;
  const drop = $("#drop");
  window.addEventListener("dragenter", (event) => {
    if (!hasDataTransferFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (depth++ === 0) {
      document.body.appendChild(Object.assign(document.createElement("div"), { className: "drag-veil" }));
      drop.classList.add("drag");
    }
  }, true);
  window.addEventListener("dragover", (event) => {
    if (!hasDataTransferFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }, true);
  window.addEventListener("dragleave", (event) => {
    if (!hasDataTransferFiles(event.dataTransfer)) return;
    if (--depth <= 0) clearDrag();
  }, true);
  window.addEventListener("drop", async (event) => {
    if (!hasDataTransferFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth = 0;
    clearDrag();
    await addFiles(await filesFromDataTransfer(event.dataTransfer));
  }, true);
  drop.addEventListener("click", (event) => {
    if (event.target.closest("button,input")) return;
    $("#fileInput").click();
  });
  drop.addEventListener("keydown", (event) => {
    if (event.target !== drop) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      $("#fileInput").click();
    }
  });

  window.addEventListener("resize", drawViz);
}

function clearDrag() {
  $(".drag-veil")?.remove();
  $("#drop").classList.remove("drag");
}

function hasDataTransferFiles(dataTransfer) {
  if (!dataTransfer) return false;
  const types = listFrom(dataTransfer.types).map((type) => String(type).toLowerCase());
  if (types.includes("files") || types.includes("application/x-moz-file")) return true;
  const items = listFrom(dataTransfer.items);
  if (items.some((item) => item?.kind === "file" || typeof item?.webkitGetAsEntry === "function")) return true;
  return listFrom(dataTransfer.files).length > 0;
}

function listFrom(value) {
  if (!value) return [];
  try {
    return Array.from(value);
  } catch (_) {
    const out = [];
    for (let i = 0; i < (value.length || 0); i++) out.push(value[i]);
    return out;
  }
}

async function addFiles(files) {
  if (!files.length) return;
  setStatus(`Reading ${files.length} file${files.length > 1 ? "s" : ""}...`);
  const loaded = await Promise.all(files.map(async (file) => ({
    name: browserFileName(file),
    size: file.size,
    lastModified: file.lastModified,
    bytes: new Uint8Array(await file.arrayBuffer()),
  })));
  for (const file of loaded) {
    const idx = state.files.findIndex((f) => f.name === file.name);
    if (idx >= 0) state.files[idx] = file;
    else state.files.push(file);
  }
  await recompute();
}

function browserFileName(file) {
  return String(file.relativePath || file.webkitRelativePath || file.name || "file")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

async function filesFromDataTransfer(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const entries = items
    .map((item) => typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null)
    .filter(Boolean);
  if (entries.length) {
    const files = (await Promise.all(entries.map((entry) => filesFromEntry(entry)))).flat();
    if (files.length) return files;
  }
  return [...(dataTransfer?.files || [])];
}

async function filesFromEntry(entry) {
  const path = String(entry.fullPath || entry.name || "").replace(/^\/+/, "");
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      entry.file(
        (file) => resolve([withRelativePath(file, path || file.name)]),
        (err) => reject(err)
      );
    });
  }
  if (!entry.isDirectory) return [];
  const children = await readAllDirectoryEntries(entry.createReader());
  return (await Promise.all(children.map((child) => filesFromEntry(child)))).flat();
}

async function readAllDirectoryEntries(reader) {
  const out = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return out;
    out.push(...batch);
  }
}

function withRelativePath(file, relativePath) {
  try {
    Object.defineProperty(file, "relativePath", { value: relativePath, configurable: true });
    return file;
  } catch (_) {
    return {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      relativePath,
      arrayBuffer: () => file.arrayBuffer(),
    };
  }
}

async function loadSampleDataset() {
  try {
    const files = await loadSampleFiles();
    for (const file of files) {
      const idx = state.files.findIndex((f) => f.name === file.name);
      if (idx >= 0) state.files[idx] = file;
      else state.files.push(file);
    }
    await recompute();
  } catch (err) {
    setStatus(`Sample dataset unavailable: ${err.message || err}`);
  }
}

async function loadSampleFiles() {
  if (typeof window !== "undefined" && window.NIRS4ALL_STANDALONE?.sampleFiles) {
    return window.NIRS4ALL_STANDALONE.sampleFiles().map((file) => ({
      name: file.name,
      size: file.bytes.byteLength,
      lastModified: 0,
      bytes: file.bytes,
    }));
  }
  const manifest = await (await fetch("./samples/manifest.json")).json();
  return Promise.all(manifest.files.map(async (entry) => {
    const bytes = new Uint8Array(await (await fetch(`./samples/${entry.name}`)).arrayBuffer());
    return { name: entry.name, size: bytes.byteLength, lastModified: 0, bytes };
  }));
}

async function recompute() {
  annotateProbes();
  annotateSidecars();
  await decodeFiles();
  if (state.mode === "builder" && window.NIRS4ALL_BUILDER) {
    await window.NIRS4ALL_BUILDER.runProposeCycle();
    return;
  }
  await inferDataset();
  state.spec = state.plan?.blocked ? null : state.plan?.resolved_spec ? structuredClone(state.plan.resolved_spec) : defaultSpec();
  chooseDefaultSignal();
  chooseDefaultTarget();
  const view = datasetView();
  if (!state.userVizSelected && (view.targetValues.length || view.targetPreviewValues.length)) state.activeViz = "targets";
  validateSpec();
  setStatus(datasetStatus());
  renderAll();
}

function annotateProbes() {
  for (const file of state.files) {
    file.probes = [];
    if (!formats?.probeBytes) continue;
    try {
      file.probes = formats.probeBytes(file.name, file.bytes) || [];
    } catch (err) {
      file.probeError = String(err.message || err);
    }
  }
}

function annotateSidecars() {
  for (const file of state.files) {
    file.sidecars = [];
    if (!formats?.sidecarRequirements) continue;
    try {
      file.sidecars = formats.sidecarRequirements(file.name, file.bytes) || [];
    } catch (err) {
      file.sidecars = [{ role: "diagnostic_error", path: String(err.message || err), required: false, alternatives: [] }];
    }
  }
}

async function decodeFiles() {
  state.decoded = [];
  if (!formats) return;
  const usedAsSidecar = sidecarUsage();
  for (const file of state.files) {
    if (usedAsSidecar.has(file.name)) continue;
    const missing = missingRequired(file);
    if (missing.length) {
      state.decoded.push({ ok: false, file: file.name, skipped: true, missing });
      continue;
    }
    try {
      const sidecars = buildSidecarMap(file);
      const records = Object.keys(sidecars).length
        ? formats.openWithSidecars(file.name, file.bytes, sidecars)
        : formats.openBytes(file.name, file.bytes);
      if (Array.isArray(records) && records.length) {
        state.decoded.push({ ok: true, file: file.name, records });
      }
    } catch (err) {
      state.decoded.push({ ok: false, file: file.name, error: String(err.message || err) });
    }
  }
}

async function inferDataset() {
  state.plan = null;
  if (!io?.inferDataset || !state.files.length) return;
  const usableFiles = state.files.filter((file) => !isInferenceExcluded(file));
  if (!usableFiles.length) {
    const exclusions = inferenceExclusions();
    const allNonSpectral = exclusions.length && exclusions.every((item) => item.kind === "non_spectral");
    state.plan = {
      blocked: true,
      overall_score: 0,
      structure: {
        value: allNonSpectral ? "non_spectral" : "format_refused",
        score: 1,
        evidence: ["nirs4all-formats refused every file before dataset inference"],
        alternatives: [],
        ambiguous: false,
      },
      warnings: exclusions.map((item) => `${item.file}: ${item.reason}`),
      recommendations: [allNonSpectral
        ? "Add wavelength-indexed spectra or raw instrument exports; derived vegetation-index tables can be used only as auxiliary metadata/targets next to spectra."
        : "Use a browser-supported encoding/export for this format or add another spectral file that nirs4all-formats can decode."],
      resolved_spec: null,
    };
    return;
  }
  try {
    state.plan = io.inferDataset(
      usableFiles.map((f) => ({ name: f.name, bytes: f.bytes })),
      recordSetsForIo(),
      {}
    );
    const exclusions = inferenceExclusions();
    if (exclusions.length) {
      state.plan.warnings = [
        ...(state.plan.warnings || []),
        ...exclusions.map((item) => `${item.file}: excluded from X inference (${item.reason})`),
      ];
    }
  } catch (err) {
    state.plan = { warnings: [`io inference failed: ${err.message || err}`], resolved_spec: defaultSpec() };
  }
}

function recordSetsForIo() {
  return state.decoded
    .filter((decoded) => decoded.ok && Array.isArray(decoded.records) && decoded.records.length)
    .map((decoded) => ({
      source: decoded.file,
      format: decodedFormat(decoded.records),
      records: decoded.records,
    }));
}

function decodedFormat(records) {
  for (const record of records) {
    const format = record?.provenance?.format || record?.metadata?.format || "";
    if (format) return String(format);
  }
  return "";
}

function reset() {
  state.files = [];
  state.decoded = [];
  state.plan = null;
  state.spec = null;
  state.activeSignal = "";
  state.activeTarget = "";
  state.activeViz = "spectra";
  state.userVizSelected = false;
  state.validation = null;
  state.confirmed = [];
  state.proposals = [];
  state.confirmedEchoes = [];
  state.steps = [];
  state.workingSpec = null;
  state.assembled = null;
  state.assembleError = null;
  state.builderError = null;
  $("#fileInput").value = "";
  setStatus("Waiting for files.");
  renderAll();
  window.NIRS4ALL_BUILDER?.reset();
}

function defaultSpec() {
  return {
    schema_version: 1,
    name: "dataset",
    sources: state.files.map((file, index) => ({
      id: index === 0 ? "data" : `source_${index + 1}`,
      role: index === 0 ? "features" : "metadata",
      input: file.name,
    })),
  };
}

function renderAll() {
  renderShellState();
  renderKpis();
  renderDatasetMap();
  renderDatasetAlerts();
  renderFiles();
  renderInference();
  renderSpecActions();
  renderVizTabs();
  renderSignalSelect();
  renderTargetSelect();
  renderSpecForm();
  drawViz();
  window.NIRS4ALL_BUILDER?.render();
}

function renderShellState() {
  document.body.classList.toggle("has-dataset", state.files.length > 0);
}

function renderKpis() {
  const view = datasetView();
  const spec = state.spec || state.plan?.resolved_spec || null;
  $("#datasetName").textContent = spec?.name || (state.files.length ? "browser dataset" : "No dataset loaded");
  const records = view.records.length;
  const features = view.axis.length || view.maxFeatures || 0;
  const targetKey = view.targetKey || "-";
  const score = state.plan?.overall_score;
  const targetItems = view.targetValues.length ? view.targetValues : view.targetPreviewValues;
  const targetStats = numericStats(targetItems.map((t) => Number(t.value)).filter(Number.isFinite));
  const targetUnit = targetStats.n
    ? `${fmtInt(targetStats.n)} values, mean ${fmtNum(targetStats.mean, 4)}`
    : view.targetKeys?.length ? "not numeric" : "not detected";
  const kpis = [
    { label: "Files", val: state.files.length, unit: bytesTotal(), acc: "var(--teal)" },
    { label: "Records", val: records, unit: records === 1 ? "spectrum" : "spectra", acc: "var(--cyan)" },
    { label: "Features", val: features || "-", unit: view.axisUnit || "channels", acc: "var(--indigo)" },
    { label: "Target", val: targetKey, unit: targetUnit, acc: "var(--amber)" },
    { label: "Inference", val: score == null ? "-" : fmtNum(score, 3), unit: decisionLabel(state.plan?.structure?.value || "waiting"), acc: "var(--green)" },
  ];
  $("#kpis").innerHTML = kpis.map((k) => `<div class="kpi" style="--accent:${k.acc}"><div class="k-label">${esc(k.label)}</div><div class="k-val">${esc(k.val)}</div><div class="k-unit">${esc(k.unit)}</div></div>`).join("");
}

function renderDatasetMap() {
  const host = $("#datasetMap");
  if (!host) return;
  const sources = state.spec?.sources || state.plan?.resolved_spec?.sources || [];
  if (!sources.length) {
    host.innerHTML = `<div class="map-empty">No dataset structure inferred yet.</div>`;
    return;
  }
  const roles = ["features", "targets", "metadata", "mixed", "weights", "ignore"];
  host.innerHTML = roles
    .map((role) => {
      const items = sources.filter((src) => src.role === role);
      if (!items.length) return "";
      return `<div class="map-role">
        <div class="map-role-title">${esc(roleLabel(role))}</div>
        <div class="map-role-items">${items.map(sourceChip).join("")}</div>
      </div>`;
    })
    .join("");
}

function renderDatasetAlerts() {
  const host = $("#datasetAlerts");
  if (!host) return;
  const missing = missingSidecarAlerts();
  const refusals = nonSpectralRefusals();
  const failures = formatDecodeFailures();
  if (!missing.length && !refusals.length && !failures.length) {
    host.innerHTML = "";
    return;
  }
  const blocks = [];
  if (missing.length) blocks.push(`<div class="dataset-alert">
    <div class="alert-head">
      <strong>${fmtInt(missing.length)} required companion file${missing.length > 1 ? "s" : ""} missing</strong>
      <button class="secondary alert-action" type="button" data-add-sidecars>Add files</button>
    </div>
    <div class="alert-list">
      ${missing.map((item) => `<div class="alert-row">
        <span class="alert-path">${esc(item.path)}</span>
        <span>for ${esc(item.primary)}</span>
        <span>${esc(sidecarRoleLabel(item.role))}</span>
        ${item.alternatives.length ? `<span>or ${esc(item.alternatives.join(" / "))}</span>` : ""}
      </div>`).join("")}
    </div>
  </div>`);
  if (refusals.length) blocks.push(`<div class="dataset-alert refusal-alert">
    <div class="alert-head">
      <strong>${fmtInt(refusals.length)} non-spectral file${refusals.length > 1 ? "s" : ""} excluded from X inference</strong>
    </div>
    <div class="alert-list">
      ${refusals.map((item) => `<div class="alert-row refusal-row">
        <span class="alert-path">${esc(item.file)}</span>
        <span>${esc(item.format || "format refusal")}</span>
        <span>${esc(item.reason)}</span>
      </div>`).join("")}
    </div>
  </div>`);
  if (failures.length) blocks.push(`<div class="dataset-alert refusal-alert">
    <div class="alert-head">
      <strong>${fmtInt(failures.length)} recognized format${failures.length > 1 ? "s" : ""} could not be decoded in this browser build</strong>
    </div>
    <div class="alert-list">
      ${failures.map((item) => `<div class="alert-row refusal-row">
        <span class="alert-path">${esc(item.file)}</span>
        <span>${esc(item.format || "format refusal")}</span>
        <span>${esc(item.reason)}</span>
      </div>`).join("")}
    </div>
  </div>`);
  host.innerHTML = blocks.join("");
}

function missingSidecarAlerts() {
  const alerts = [];
  for (const file of state.files) {
    for (const req of missingRequired(file)) {
      alerts.push({
        primary: file.name,
        path: req.path || baseName(file.name),
        role: req.role || "sidecar",
        alternatives: (req.alternatives || []).filter(Boolean),
        reason: req.reason || "",
      });
    }
  }
  return alerts;
}

function nonSpectralRefusals() {
  return state.files.map(nonSpectralRefusal).filter(Boolean);
}

function nonSpectralRefusal(file) {
  const decoded = state.decoded.find((d) => d.file === file.name);
  const probe = topProbe(file);
  const text = [probe?.format, probe?.reason, decoded?.error, file.probeError]
    .filter(Boolean)
    .join(" ");
  if (!/(non[- ]spectral|not wavelength-indexed spectra|derived vegetation-index|mass-spectrometry data, not NIRS spectroscopy)/i.test(text)) return null;
  return {
    kind: "non_spectral",
    file: file.name,
    format: probe?.format || "",
    reason: shortError(decoded?.error || probe?.reason || file.probeError || "not wavelength-indexed spectra"),
  };
}

function isNonSpectralRefusal(file) {
  return Boolean(nonSpectralRefusal(file));
}

function formatDecodeFailures() {
  return state.files.map(formatDecodeFailure).filter(Boolean);
}

function formatDecodeFailure(file) {
  if (isNonSpectralRefusal(file)) return null;
  const decoded = state.decoded.find((d) => d.file === file.name);
  if (!decoded?.error) return null;
  const probe = topProbe(file);
  const confidence = String(probe?.confidence || "").toLowerCase();
  if (!probe || (confidence !== "definite" && !isBrowserUnsupportedDecode(decoded.error))) return null;
  return {
    kind: "decode_failure",
    file: file.name,
    format: probe.format || "",
    reason: shortError(decoded.error),
  };
}

function isBrowserUnsupportedDecode(error) {
  return /(Disabled feature at compile time|unsupported .*compression|browser build|WASM build)/i.test(String(error || ""));
}

function inferenceExclusions() {
  return [...nonSpectralRefusals(), ...formatDecodeFailures()];
}

function isInferenceExcluded(file) {
  return isNonSpectralRefusal(file) || Boolean(formatDecodeFailure(file));
}

function sourceChip(src) {
  const inputs = asInputList(src.input).map(baseName).join(", ");
  const partition = src.partition ? `<span>${esc(src.partition)}</span>` : "";
  const join = src.join?.right ? `<span>joins ${esc(src.join.right)}</span>` : "";
  const params = src.params?.header_unit ? `<span>${esc(src.params.header_unit)}</span>` : "";
  return `<div class="map-chip">
    <strong>${esc(src.id || src.role || "source")}</strong>
    <small>${esc(inputs || "no input")}</small>
    <div>${partition}${join}${params}</div>
  </div>`;
}

function roleLabel(role) {
  return ({
    features: "X / spectra",
    targets: "y / targets",
    metadata: "metadata",
    mixed: "mixed records",
    weights: "weights",
    ignore: "ignored",
  })[role] || role;
}

function fileSourceBadge(role) {
  return ({
    features: "X source",
    targets: "y source",
    metadata: "meta source",
    mixed: "mixed",
    weights: "weights",
    ignore: "ignored",
  })[role] || `${role} source`;
}

function sidecarRoleLabel(role) {
  return ({
    wavelength_sidecar: "wavelength axis",
    ground_truth_sidecar: "ground truth",
    header_sidecar: "header",
    binary_sidecar: "binary payload",
    data_sidecar: "data payload",
    qc_sidecar: "quality metadata",
    diagnostic_error: "diagnostic",
  })[role] || role.replace(/_/g, " ");
}

function renderFiles() {
  $("#fileCount").textContent = state.files.length;
  const host = $("#fileList");
  if (!state.files.length) {
    host.innerHTML = $("#emptyFileList").innerHTML;
    return;
  }
  host.innerHTML = state.files.map((file) => {
    const sidecars = file.sidecars || [];
    const source = sourceForFile(file.name);
    const probe = topProbe(file);
    const tags = sidecars.map((req) => {
      const present = sidecarPresent(req);
      const cls = present ? "present" : req.required ? "missing" : "";
      const prefix = req.required ? "req" : "opt";
      return `<span class="sidecar ${cls}" title="${esc(req.reason || "")}">${prefix}:${esc(req.role)} ${esc(req.path)}</span>`;
    }).join("");
    const decoded = state.decoded.find((d) => d.file === file.name);
    const badge = decoded?.ok
      ? `<span class="pill ok">spectra</span>`
      : decoded?.missing?.length
        ? `<span class="pill err">missing sidecar</span>`
        : source
          ? `<span class="pill ok">${esc(fileSourceBadge(source.role))}</span>`
          : decoded?.error
            ? `<span class="pill warn">not used</span>`
            : probe
              ? `<span class="pill">${esc(probeLabel(probe))}</span>`
              : `<span class="pill">queued</span>`;
    const sourceMeta = source ? ` · ${source.role}${source.partition ? `:${source.partition}` : ""}` : "";
    const probeMeta = fileFormatMeta(file, decoded, probe);
    return `<div class="file-row">
      <div class="file-top"><div class="file-name" title="${esc(file.name)}">${esc(file.name)}</div>${badge}</div>
      <div class="file-meta">${fmtBytes(file.size || file.bytes.length)} · .${esc(extOf(file.name) || "file")}${esc(sourceMeta)}</div>
      ${probeMeta ? `<div class="file-probe">${probeMeta}</div>` : ""}
      ${tags ? `<div class="sidecars">${tags}</div>` : ""}
    </div>`;
  }).join("");
}

function topProbe(file) {
  return Array.isArray(file.probes) && file.probes.length ? file.probes[0] : null;
}

function probeLabel(probe) {
  return probe?.confidence ? String(probe.confidence) : "detected";
}

function fileFormatMeta(file, decoded, probe) {
  if (decoded?.ok) {
    const format = decodedFormat(decoded.records) || probe?.format || "decoded";
    const count = Array.isArray(decoded.records) ? decoded.records.length : 0;
    return `<span class="probe-format">${esc(format)}</span><span>${fmtInt(count)} record${count === 1 ? "" : "s"}</span>`;
  }
  if (decoded?.error) {
    return `<span class="probe-error">${esc(shortError(decoded.error))}</span>`;
  }
  if (file.probeError) {
    return `<span class="probe-error">${esc(shortError(file.probeError))}</span>`;
  }
  if (!probe) return "";
  const reader = shortReader(probe.reader);
  const reason = probe.reason ? `<span title="${esc(probe.reason)}">${esc(probe.reason)}</span>` : "";
  return `<span class="probe-format">${esc(probe.format || "detected")}</span><span>${esc(probe.confidence || "candidate")}</span>${reader ? `<span>${esc(reader)}</span>` : ""}${reason}`;
}

function shortReader(reader) {
  return String(reader || "").split("::").filter(Boolean).pop() || "";
}

function shortError(error) {
  return String(error || "").replace(/^Error:\s*/i, "").slice(0, 180);
}

function renderInference() {
  const plan = state.plan;
  const score = plan?.overall_score;
  $("#scoreBadge").textContent = score == null ? "-" : fmtNum(score, 3);
  $("#scoreBadge").className = `pill ${score >= .75 ? "ok" : score >= .45 ? "warn" : ""}`;
  const decisions = [
    ["Structure", plan?.structure],
    ["Identity", plan?.identity],
    ["Signal", plan?.signal_type],
    ["Task", plan?.task_type],
  ];
  const warnings = plan?.warnings || [];
  $("#decisionList").innerHTML = renderReaderCoverage() + decisions.map(([label, d]) => {
    const value = d?.value ?? "-";
    const evidence = (d?.evidence || []).join(" ");
    return `<div class="decision"><strong>${esc(label)} <span class="pill">${esc(decisionLabel(value))}${d?.score != null ? ` ${fmtNum(d.score, 3)}` : ""}</span></strong><p>${esc(evidence || "No decision yet.")}</p></div>`;
  }).join("") + renderPlanEvidence(plan) + warnings.map((w) => `<div class="decision warn-decision"><strong>Warning</strong><p>${esc(w)}</p></div>`).join("");
}

function renderReaderCoverage() {
  if (!formats?.readerCatalog) return "";
  let catalog = [];
  try {
    catalog = formats.readerCatalog() || [];
  } catch (err) {
    return `<div class="decision warn-decision"><strong>Reader coverage</strong><p>${esc(err.message || err)}</p></div>`;
  }
  const features = formatFeatures(formats) || {};
  const featureText = [
    features.hdf5 ? "HDF5/NetCDF" : "",
    features.matlab ? "MATLAB/RData" : "",
    features.parquet ? "Parquet" : "",
  ].filter(Boolean).join(" · ") || "base readers";
  const readers = catalog.map((entry) => shortReader(entry.reader || "")).filter(Boolean);
  return `<div class="decision evidence-block reader-coverage">
    <strong>Reader coverage <span class="pill ok">${fmtInt(readers.length)} readers</span></strong>
    <p>${esc(featureText)}</p>
    <div class="reader-tags">${readers.map((reader) => `<span>${esc(reader)}</span>`).join("")}</div>
  </div>`;
}

function renderPlanEvidence(plan) {
  if (!plan) return "";
  const blocks = [];
  if (Array.isArray(plan.assignments) && plan.assignments.length) {
    blocks.push(`<div class="decision evidence-block">
      <strong>File assignments <span class="pill">${fmtInt(plan.assignments.length)}</span></strong>
      <div class="evidence-grid">${plan.assignments.slice(0, 10).map(assignmentChip).join("")}</div>
    </div>`);
  }
  if (Array.isArray(plan.columns) && plan.columns.length) {
    blocks.push(`<div class="decision evidence-block">
      <strong>Column / record roles <span class="pill">${fmtInt(plan.columns.length)}</span></strong>
      <div class="evidence-list">${plan.columns.slice(0, 8).map(columnEvidenceRow).join("")}</div>
    </div>`);
  }
  if (plan.axis && typeof plan.axis === "object") {
    blocks.push(`<div class="decision evidence-block">
      <strong>Axis <span class="pill">${esc(plan.axis.unit || "axis")}</span></strong>
      <p>${esc(axisSummary(plan.axis))}</p>
    </div>`);
  }
  const params = plan.params && typeof plan.params === "object" ? plan.params : {};
  const paramRows = planParamRows(params);
  if (paramRows.length) {
    blocks.push(`<div class="decision evidence-block">
      <strong>Parameters <span class="pill">${fmtInt(paramRows.length)}</span></strong>
      <div class="evidence-list">${paramRows.slice(0, 8).map(([key, value]) => `<div class="evidence-row"><span>${esc(key)}</span><small>${esc(value)}</small></div>`).join("")}</div>
    </div>`);
  }
  if (Array.isArray(plan.recommendations) && plan.recommendations.length) {
    blocks.push(`<div class="decision evidence-block">
      <strong>Recommendations</strong>
      ${plan.recommendations.slice(0, 4).map((r) => `<p>${esc(r)}</p>`).join("")}
    </div>`);
  }
  if (Array.isArray(plan.dropped_rows) && plan.dropped_rows.length) {
    blocks.push(`<div class="decision warn-decision"><strong>Dropped rows <span class="pill warn">${fmtInt(plan.dropped_rows.length)}</span></strong><p>${esc(JSON.stringify(plan.dropped_rows.slice(0, 3)))}</p></div>`);
  }
  return blocks.join("");
}

function assignmentChip(item) {
  if (item?.analysis && Array.isArray(item.assignments)) {
    return `<div class="evidence-chip"><strong>${esc(item.analysis)}</strong><span>${fmtInt(item.assignments.length)} assignments</span></div>`;
  }
  const ref = item?.ref || item?.name || "file";
  const parts = [item?.role, item?.partition, item?.source_index != null ? `#${item.source_index}` : ""].filter(Boolean);
  const evidence = Array.isArray(item?.evidence) ? item.evidence.join(" ") : "";
  return `<div class="evidence-chip" title="${esc(evidence)}">
    <strong>${esc(baseName(ref))}</strong>
    <span>${esc(parts.join(" · ") || "assigned")}${item?.score != null ? ` · ${fmtNum(Number(item.score), 3)}` : ""}</span>
  </div>`;
}

function columnEvidenceRow(item) {
  const ref = item?.ref || item?.analysis || "records";
  const chips = [];
  if (item?.record_roles) {
    for (const [role, values] of Object.entries(item.record_roles)) {
      if (Array.isArray(values) && values.length) chips.push(`${role}: ${values.slice(0, 4).join(", ")}${values.length > 4 ? " +" : ""}`);
    }
  }
  if (Array.isArray(item?.column_roles)) {
    const grouped = {};
    for (const col of item.column_roles) {
      const role = col.role || "unknown";
      (grouped[role] ||= []).push(col.col || col.name || "?");
    }
    for (const [role, cols] of Object.entries(grouped)) chips.push(`${role}: ${cols.slice(0, 4).join(", ")}${cols.length > 4 ? " +" : ""}`);
  }
  return `<div class="evidence-row">
    <span>${esc(baseName(ref))}</span>
    <small>${esc(chips.join(" · ") || JSON.stringify(item).slice(0, 140))}</small>
  </div>`;
}

function axisSummary(axis) {
  const range = Array.isArray(axis.range) ? `${fmtNum(Number(axis.range[0]), 5)} to ${fmtNum(Number(axis.range[1]), 5)}` : "";
  return [`${fmtInt(Number(axis.n))} points`, axis.unit || "", range, axis.source || "", axis.score != null ? `score ${fmtNum(Number(axis.score), 3)}` : ""].filter(Boolean).join(" · ");
}

function planParamRows(params) {
  const rows = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null) continue;
    if (key === "repetition" && typeof value === "object") {
      rows.push(["repetition", compactObject(value)]);
    } else if (key === "browser_dataset" && typeof value === "object") {
      rows.push(["browser dataset", compactObject(value)]);
    } else if (typeof value === "object" && !Array.isArray(value)) {
      rows.push([key, compactObject(value)]);
    } else {
      rows.push([key, valueText(value)]);
    }
  }
  return rows;
}

function compactObject(value) {
  return Object.entries(value || {})
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(",") : typeof v === "object" && v ? compactObject(v) : valueText(v)}`)
    .join(" · ");
}

function renderSpecActions() {
  const disabled = !state.spec;
  for (const id of ["resetSpec", "copySpec", "downloadSpec"]) {
    const btn = $(`#${id}`);
    if (btn) btn.disabled = disabled;
  }
}

function resetSpecToInferred() {
  if (!state.files.length) return;
  state.spec = state.plan?.resolved_spec ? structuredClone(state.plan.resolved_spec) : defaultSpec();
  chooseDefaultTarget();
  validateSpec();
  setStatus("Dataset spec reset to the latest nirs4all-io inference.");
  renderAll();
}

async function copySpecJson() {
  if (!state.spec) return;
  const text = JSON.stringify(state.spec, null, 2);
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    setStatus("Canonical dataset JSON copied.");
  } catch (_) {
    const textarea = $("#specForm textarea[name='json']");
    textarea?.focus();
    textarea?.select();
    setStatus("Canonical dataset JSON is selected for copying.");
  }
}

function downloadSpecJson() {
  if (!state.spec) return;
  const text = JSON.stringify(state.spec, null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `${safeFileStem(state.spec.name || "dataset")}.nirs4all.json`,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("Canonical dataset JSON downloaded.");
}

function decisionLabel(value) {
  return ({
    train_test_folder: "train/test",
    x_y_separate: "X/y files",
    single_combined: "single table",
    decoded_records: "decoded records",
    decoded_record_corpus: "decoded corpus",
    vendor_corpus: "vendor corpus",
    non_spectral: "non-spectral",
    format_refused: "format refused",
    unknown: "unknown",
  })[value] || value;
}

function renderSignalSelect() {
  const view = datasetView();
  const signals = view.signals;
  const sel = $("#signalSelect");
  const old = state.activeSignal;
  sel.innerHTML = signals.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  if (signals.includes(old)) sel.value = old;
  else if (signals[0]) {
    sel.value = signals[0];
    state.activeSignal = signals[0];
  }
}

function renderTargetSelect() {
  const view = datasetView();
  const keys = view.targetKeys;
  const sel = $("#targetSelect");
  if (!keys.length) {
    sel.innerHTML = `<option value="">no y</option>`;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = keys.map((key) => `<option value="${esc(key)}">${esc(key)}</option>`).join("");
  sel.value = keys.includes(state.activeTarget) ? state.activeTarget : keys[0];
}

function renderVizTabs() {
  $$(".tab", $("#vizTabs")).forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.viz === state.activeViz);
  });
}

const SPEC_ACCENTS = ["var(--teal)", "var(--cyan)", "var(--indigo)", "var(--amber)", "var(--green)"];

function renderSpecForm() {
  const spec = state.spec;
  const host = $("#specForm");
  if (!spec) {
    host.innerHTML = `<div class="empty">Dataset properties appear after inference.</div>`;
    $("#validationBadge").textContent = "not validated";
    $("#validationBadge").className = "pill";
    return;
  }
  const task = spec.task_type || state.plan?.task_type?.value || "auto";
  const rawSignal = spec.signal_type || (spec.params && spec.params.signal_type) || state.plan?.signal_type?.value || "auto";
  const signal = SIGNAL_TYPES.includes(rawSignal) ? rawSignal : "auto";
  const sampleIndex = spec.sample_index || {};
  const aggregate = spec.aggregate || {};
  const partitions = spec.partitions || {};
  const folds = spec.folds || {};
  host.innerHTML = `
    <div class="spec-overview">${specOverviewItems(spec).map((item, i) => `
      <div class="spec-stat" style="--accent:${SPEC_ACCENTS[i % SPEC_ACCENTS.length]}">
        <span>${esc(item.label)}</span>
        <strong>${esc(item.value)}</strong>
        <small>${esc(item.detail)}</small>
      </div>`).join("")}
    </div>

    <section class="spec-section">
      <div class="section-title">
        <div><p class="eyebrow">DatasetSpec</p><h4>Identity</h4></div>
      </div>
      <div class="form-grid">
      ${field("Schema version", `<input name="schema_version" type="text" value="${esc(spec.schema_version ?? 1)}" />`)}
      ${field("Dataset name", `<input name="name" type="text" value="${esc(spec.name || "")}" />`)}
      ${field("Description", `<input name="description" type="text" value="${esc(spec.description || "")}" />`)}
      ${field("Task type", select("task_type", ["auto", "regression", "binary", "multiclass"], task))}
      ${field("Signal type", select("signal_type", SIGNAL_TYPES, signal))}
      ${field("Sample index", select("sample_index_by", ["row", "id"], sampleIndex.by || "row"))}
      ${field("Sample key", `<input name="sample_index_key" type="text" value="${esc(valueText(sampleIndex.key))}" />`)}
      ${field("Observation ID", `<input name="sample_observation_id" type="text" value="${esc(sampleIndex.observation_id || "")}" />`)}
      ${field("Repetition ID", `<input name="sample_repetition_id" type="text" value="${esc(sampleIndex.repetition_id || "")}" />`)}
      ${field("Group ID", `<input name="sample_group_id" type="text" value="${esc(sampleIndex.group_id || "")}" />`)}
      ${field("Derive from", `<input name="sample_derive_from" type="text" value="${esc(sampleIndex.derive?.from || "")}" />`)}
      ${field("Strip suffix", `<input name="sample_derive_pattern" type="text" value="${esc(sampleIndex.derive?.strip_suffix || "")}" />`)}
      ${field("Repetition", `<input name="repetition" type="text" value="${esc(spec.repetition || "")}" />`)}
      ${field("Aggregate method", select("aggregate_method", AGGREGATE_METHODS, aggregate.method || ""))}
      ${field("Aggregate by", `<input name="aggregate_by" type="text" value="${esc(aggregate.by || "")}" />`)}
      ${field("Exclude outliers", select("aggregate_exclude_outliers", ["false", "true"], String(Boolean(aggregate.exclude_outliers))))}
      ${field("Outlier threshold", `<input name="aggregate_outlier_threshold" type="text" value="${esc(aggregate.outlier_threshold ?? "")}" />`)}
      </div>
    </section>

    <section class="spec-section">
      <div class="section-title">
        <div><p class="eyebrow">DatasetSpec</p><h4>Partitions & folds</h4></div>
      </div>
      <div class="form-grid">
        ${field("Partition mode", select("partitions_by", PARTITION_BY, partitions.by || ""))}
        ${field("Partition column", `<input name="partitions_column" type="text" value="${esc(partitions.column || "")}" />`)}
        ${field("Unknown policy", select("partitions_unknown_policy", UNKNOWN_POLICIES, partitions.unknown_policy || "train"))}
        ${field("Train values", `<input name="partitions_train_values" type="text" value="${esc(joinValueList(partitions.train_values))}" />`)}
        ${field("Test values", `<input name="partitions_test_values" type="text" value="${esc(joinValueList(partitions.test_values))}" />`)}
        ${field("Predict values", `<input name="partitions_predict_values" type="text" value="${esc(joinValueList(partitions.predict_values))}" />`)}
        ${field("Train index/file", `<input name="partitions_train" type="text" value="${esc(valueText(partitions.train ?? partitions.train_file))}" />`)}
        ${field("Test index/file", `<input name="partitions_test" type="text" value="${esc(valueText(partitions.test ?? partitions.test_file))}" />`)}
        ${field("Predict index/file", `<input name="partitions_predict" type="text" value="${esc(valueText(partitions.predict ?? partitions.predict_file))}" />`)}
        ${field("Folds file", `<input name="folds_file" type="text" value="${esc(folds.file || "")}" />`)}
        ${field("Folds format", select("folds_format", FOLD_FORMATS, folds.format || "auto"))}
        ${field("Folds column", `<input name="folds_column" type="text" value="${esc(folds.column || "")}" />`)}
      </div>
      <div class="field wide-field">
        <label>Folds inline</label>
        <textarea name="folds_inline" spellcheck="false">${esc(jsonText(folds.inline, ""))}</textarea>
      </div>
    </section>

    <section class="spec-section">
      <div class="section-title">
        <div><p class="eyebrow">DatasetSpec</p><h4>Global loading & validation</h4></div>
      </div>
      <div class="form-grid">
        ${field("Check files", select("validation_check_file_existence", ["true", "false"], String(spec.validation?.check_file_existence !== false)))}
        ${field("Allow train only", select("validation_allow_train_only", ["true", "false"], String(spec.validation?.allow_train_only !== false)))}
        ${field("Allow test only", select("validation_allow_test_only", ["true", "false"], String(spec.validation?.allow_test_only !== false)))}
      </div>
      <div class="advanced-grid">
        <div class="field wide-field">
          <label>Conventions</label>
          <textarea name="conventions_json" spellcheck="false">${esc(jsonText(spec.conventions, ""))}</textarea>
        </div>
        <div class="field wide-field">
          <label>Global params</label>
          <textarea name="global_params_json" spellcheck="false">${esc(jsonText(spec.params, ""))}</textarea>
        </div>
      </div>
    </section>

    <section class="spec-section">
      <div class="section-title">
        <div><p class="eyebrow">DatasetSpec</p><h4>Sources</h4></div>
        <button class="secondary compact" type="button" data-add-source>Add source</button>
      </div>
      <div class="source-list" id="sourceList">${(spec.sources || []).map(sourceRow).join("")}</div>
    </section>

    <div class="field">
      <label>Canonical JSON</label>
      <textarea class="json-editor" name="json" spellcheck="false">${esc(JSON.stringify(spec, null, 2))}</textarea>
    </div>`;
  host.oninput = handleSpecInput;
  host.onchange = handleSpecInput;
  host.onclick = handleSpecClick;
  renderValidationBadge();
}

function sourceRow(src, i) {
  const params = src.params || {};
  return `<div class="source-row" data-source="${i}">
    <div class="source-title">
      <div>
        <strong>${esc(src.id || `source_${i + 1}`)}</strong>
        <span>${esc(roleLabel(src.role || "features"))}</span>
      </div>
      <button class="icon-btn source-remove" type="button" data-remove-source="${i}" title="Remove source" aria-label="Remove source">
        <svg viewBox="0 0 24 24"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="source-chips">${sourceChips(src).map((chip) => `<span>${esc(chip)}</span>`).join("")}</div>
    <div class="source-fields">
      ${field("ID", `<input name="source_id" type="text" value="${esc(src.id || "")}" />`)}
      ${field("Role", select("source_role", SOURCE_ROLES, src.role || "features"))}
      ${field("Kind", select("source_kind", SOURCE_KINDS, src.kind || "table"))}
      ${field("Partition", select("source_partition", PARTITIONS, src.partition || ""))}
      ${field("Input", `<input class="wide" name="source_input" type="text" value="${esc(inputText(src.input))}" />`)}
      ${field("Key", `<input name="source_key" type="text" value="${esc(valueText(src.key))}" />`)}
      ${field("Merge", select("source_merge", MERGE_MODES, src.merge && src.merge !== "none" ? src.merge : ""))}
      ${field("Modality", select("source_modality", SOURCE_MODALITIES, src.modality || ""))}
    </div>
    <details class="source-advanced">
      <summary>Columns, joins & loading</summary>
      <div class="advanced-grid">
        ${field("Delimiter", `<input name="source_delimiter" type="text" value="${esc(params.delimiter || "")}" />`)}
        ${field("Decimal", `<input name="source_decimal" type="text" value="${esc(params.decimal_separator || params.decimal || "")}" />`)}
        ${field("Header", select("source_header", ["", "true", "false"], params.has_header == null ? "" : String(params.has_header)))}
        ${field("Header unit", select("source_header_unit", HEADER_UNITS, params.header_unit || ""))}
        ${field("Signal", select("source_signal_type", SIGNAL_TYPES, params.signal_type || ""))}
        ${field("Encoding", `<input name="source_encoding" type="text" value="${esc(params.encoding || "")}" />`)}
        ${field("NA policy", select("source_na_policy", NA_POLICIES, params.na?.policy || "auto"))}
        ${field("Categorical", select("source_categorical", CATEGORICAL_MODES, params.categorical || ""))}
        ${field("Strict columns", select("source_strict_columns", ["true", "false"], String(src.strict_columns !== false)))}
        ${field("Join left", `<input name="source_join_left" type="text" value="${esc(src.join?.left || "")}" />`)}
        ${field("Join right", `<input name="source_join_right" type="text" value="${esc(src.join?.right || "")}" />`)}
        ${field("Cardinality", select("source_join_cardinality", JOIN_CARDINALITIES, src.join?.cardinality || src.join?.how || "1:1"))}
        ${field("Coverage", select("source_join_coverage", JOIN_COVERAGE, src.join?.coverage || "complete"))}
        ${field("Left on", `<input name="source_join_left_on" type="text" value="${esc(valueText(src.join?.left_on ?? src.join?.on))}" />`)}
        ${field("Right on", `<input name="source_join_right_on" type="text" value="${esc(valueText(src.join?.right_on ?? src.join?.on))}" />`)}
        <div class="field wide-field">
          <label>Columns</label>
          <textarea name="source_columns" spellcheck="false">${esc(jsonText(src.columns, ""))}</textarea>
        </div>
        <div class="field wide-field">
          <label>Format params</label>
          <textarea name="source_format_json" spellcheck="false">${esc(jsonText(params.format, ""))}</textarea>
        </div>
        <div class="field wide-field">
          <label>Variations</label>
          <textarea name="source_variations" spellcheck="false">${esc(jsonText(src.variations, ""))}</textarea>
        </div>
      </div>
    </details>
  </div>`;
}

function field(label, control) {
  return `<div class="field"><label>${esc(label)}</label>${control}</div>`;
}

function select(name, options, value) {
  return `<select name="${name}">${options.map((opt) => `<option value="${esc(opt)}" ${String(value) === String(opt) ? "selected" : ""}>${esc(opt || "-")}</option>`).join("")}</select>`;
}

function specOverviewItems(spec) {
  const sources = spec.sources || [];
  const countRole = (role) => sources.filter((src) => src.role === role || (role === "features" && src.role === "mixed")).length;
  const partitions = [...new Set(sources.map((src) => src.partition).filter(Boolean))];
  const joins = sources.filter((src) => src.join?.right).length;
  const targetCols = sources.flatMap((src) => sourceColumnsByRole(src, "targets"));
  return [
    {
      label: "Structure",
      value: decisionLabel(state.plan?.structure?.value || "manual"),
      detail: `${fmtInt(sources.length)} sources${joins ? `, ${fmtInt(joins)} joins` : ""}`,
    },
    {
      label: "X",
      value: countRole("features") || "-",
      detail: sourceInputsForRole(sources, "features").slice(0, 2).join(", ") || "not mapped",
    },
    {
      label: "Y",
      value: countRole("targets") || targetCols.length || "-",
      detail: targetCols.slice(0, 3).join(", ") || sourceInputsForRole(sources, "targets").slice(0, 2).join(", ") || "not mapped",
    },
    {
      label: "Identity",
      value: spec.sample_index?.by || "row",
      detail: [valueText(spec.sample_index?.key), spec.sample_index?.repetition_id].filter(Boolean).join(" / ") || "row order",
    },
    {
      label: "Split",
      value: partitions.length ? partitions.join("/") : spec.partitions?.by || "-",
      detail: spec.folds ? "folds configured" : "no folds",
    },
  ];
}

function sourceInputsForRole(sources, role) {
  return sources
    .filter((src) => src.role === role || (role === "features" && src.role === "mixed"))
    .flatMap((src) => asInputList(src.input).map(baseName));
}

function sourceChips(src) {
  const chips = [];
  const inputs = asInputList(src.input).map(baseName);
  if (inputs.length) chips.push(inputs.length === 1 ? inputs[0] : `${inputs.length} files`);
  if (src.partition) chips.push(src.partition);
  if (src.key != null && valueText(src.key)) chips.push(`key ${valueText(src.key)}`);
  if (src.merge && src.merge !== "none") chips.push(src.merge);
  if (src.join?.right) chips.push(`join ${src.join.right}`);
  if (src.repetition) chips.push(`rep ${src.repetition}`);
  for (const role of ["features", "targets", "metadata", "weights"]) {
    const cols = sourceColumnsByRole(src, role);
    if (cols.length) chips.push(`${role}:${cols.slice(0, 3).join("|")}${cols.length > 3 ? "+" : ""}`);
  }
  for (const hint of sourceInferenceHint(src)) chips.push(hint);
  return chips.slice(0, 8);
}

function sourceInferenceHint(src) {
  const refs = asInputList(src.input).map((name) => new Set([name, baseName(name)]));
  const id = src.id || "";
  const hit = (state.plan?.columns || []).find((entry) => {
    const ref = String(entry.ref || "");
    return ref === id || refs.some((names) => names.has(ref) || names.has(baseName(ref)));
  });
  if (!hit) return [];
  if (hit.record_roles) {
    return Object.entries(hit.record_roles)
      .filter(([, values]) => Array.isArray(values) && values.length)
      .map(([role, values]) => `${role}:${values.slice(0, 3).join("|")}${values.length > 3 ? "+" : ""}`);
  }
  if (Array.isArray(hit.column_roles)) {
    const counts = {};
    for (const col of hit.column_roles) counts[col.role || "unknown"] = (counts[col.role || "unknown"] || 0) + 1;
    return Object.entries(counts).map(([role, count]) => `${role}:${count}`);
  }
  return [];
}

function sourceColumnsByRole(src, role) {
  const columns = src.columns;
  if (!columns) return [];
  if (Array.isArray(columns)) {
    return columns
      .filter((col) => col?.role === role)
      .flatMap((col) => selectorLabels(col.select));
  }
  if (columns && typeof columns === "object" && columns[role] != null) {
    return selectorLabels(columns[role]);
  }
  return [];
}

function selectorLabels(select) {
  if (Array.isArray(select)) return select.map((v) => String(v));
  if (typeof select === "string" || typeof select === "number") return [String(select)];
  if (select && typeof select === "object") return [JSON.stringify(select)];
  return [];
}

function inputText(input) {
  if (Array.isArray(input)) return input.join(", ");
  return valueText(input);
}

function valueText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function jsonText(value, fallback = "") {
  if (value == null) return fallback;
  if (Array.isArray(value) && !value.length) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) return fallback;
  return JSON.stringify(value, null, 2);
}

function joinValueList(values) {
  return Array.isArray(values) ? values.map(valueText).join(", ") : "";
}

function setString(obj, key, value) {
  const text = String(value ?? "").trim();
  if (text) obj[key] = text;
  else delete obj[key];
}

function parseOptionalJson(text, label) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label}: invalid JSON (${err.message})`);
  }
}

function parseLooseValue(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (/^[\[{"]/.test(raw) || /^(true|false|null|-?\d+(\.\d+)?([eE][+-]?\d+)?)$/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return raw;
    }
  }
  return raw;
}

function parseValueList(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const parsed = raw.startsWith("[") ? parseLooseValue(raw) : null;
  if (Array.isArray(parsed)) return parsed;
  return raw.split(",").map((part) => parseLooseValue(part)).filter((v) => valueText(v) !== "");
}

function nextSourceId(spec) {
  const ids = new Set((spec.sources || []).map((src) => src.id));
  let i = (spec.sources || []).length + 1;
  while (ids.has(`source_${i}`)) i++;
  return `source_${i}`;
}

function handleSpecInput(event) {
  if (event.target.name === "json") {
    try {
      state.spec = JSON.parse(event.target.value);
      chooseDefaultSignal();
      chooseDefaultTarget();
      validateSpec();
      renderAll();
    } catch (err) {
      state.validation = { ok: false, message: err.message };
      renderValidationBadge();
    }
    return;
  }
  if (event.type === "input" && event.target.tagName === "TEXTAREA") return;
  const form = $("#specForm");
  try {
    const spec = specFromForm(form);
    state.spec = spec;
    chooseDefaultSignal();
    chooseDefaultTarget();
    validateSpec();
    form.elements.json.value = JSON.stringify(spec, null, 2);
    refreshSpecDrivenViews();
  } catch (err) {
    state.validation = { ok: false, message: err.message || String(err) };
    renderValidationBadge();
  }
}

function handleSpecClick(event) {
  const add = event.target.closest("[data-add-source]");
  if (add) {
    event.preventDefault();
    const spec = structuredClone(state.spec || defaultSpec());
    spec.sources = [...(spec.sources || []), { id: nextSourceId(spec), role: "metadata", input: "" }];
    state.spec = spec;
    validateSpec();
    renderAll();
    return;
  }
  const remove = event.target.closest("[data-remove-source]");
  if (remove) {
    event.preventDefault();
    const index = Number(remove.dataset.removeSource);
    const spec = structuredClone(state.spec || defaultSpec());
    spec.sources = (spec.sources || []).filter((_, i) => i !== index);
    state.spec = spec;
    chooseDefaultTarget();
    validateSpec();
    renderAll();
  }
}

function specFromForm(form) {
  const spec = structuredClone(state.spec || defaultSpec());
  const schemaVersion = Number(form.elements.schema_version?.value || 1);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new Error("schema_version must be a positive integer");
  spec.schema_version = schemaVersion;
  spec.name = form.elements.name?.value || "dataset";
  setString(spec, "description", form.elements.description?.value);

  const task = form.elements.task_type?.value || "auto";
  if (task === "auto") delete spec.task_type; else spec.task_type = task;

  const signal = form.elements.signal_type?.value || "auto";
  if (signal === "auto") {
    delete spec.signal_type;
    if (spec.params) delete spec.params.signal_type;
  } else {
    spec.signal_type = signal;
  }

  spec.sample_index = sampleIndexFromForm(form);
  setString(spec, "repetition", form.elements.repetition?.value);
  applyAggregateFromForm(spec, form);
  applyPartitionsFromForm(spec, form);
  applyFoldsFromForm(spec, form);
  applyGlobalSpecFieldsFromForm(spec, form);
  spec.sources = $$(".source-row", form).map(sourceFromRow);
  return spec;
}

function sampleIndexFromForm(form) {
  const si = {};
  si.by = form.elements.sample_index_by?.value || "row";
  const keyText = form.elements.sample_index_key?.value || "";
  if (keyText.trim()) si.key = parseLooseValue(keyText);
  setString(si, "observation_id", form.elements.sample_observation_id?.value);
  setString(si, "repetition_id", form.elements.sample_repetition_id?.value);
  setString(si, "group_id", form.elements.sample_group_id?.value);
  const deriveFrom = String(form.elements.sample_derive_from?.value || "").trim();
  const derivePattern = String(form.elements.sample_derive_pattern?.value || "").trim();
  if (deriveFrom) {
    si.derive = { from: deriveFrom };
    if (derivePattern) si.derive.strip_suffix = derivePattern;
  }
  if (si.by === "id" && si.key == null) si.key = "";
  return si;
}

function applyAggregateFromForm(spec, form) {
  const method = form.elements.aggregate_method?.value || "";
  if (!method) {
    delete spec.aggregate;
    return;
  }
  const aggregate = { method };
  setString(aggregate, "by", form.elements.aggregate_by?.value);
  const exclude = form.elements.aggregate_exclude_outliers?.value === "true";
  if (exclude) {
    aggregate.exclude_outliers = true;
    const threshold = Number(form.elements.aggregate_outlier_threshold?.value);
    aggregate.outlier_threshold = Number.isFinite(threshold) ? threshold : 0.95;
  }
  spec.aggregate = aggregate;
}

function applyPartitionsFromForm(spec, form) {
  const p = {};
  setString(p, "by", form.elements.partitions_by?.value);
  setString(p, "column", form.elements.partitions_column?.value);
  const trainValues = parseValueList(form.elements.partitions_train_values?.value);
  const testValues = parseValueList(form.elements.partitions_test_values?.value);
  const predictValues = parseValueList(form.elements.partitions_predict_values?.value);
  if (trainValues.length) p.train_values = trainValues;
  if (testValues.length) p.test_values = testValues;
  if (predictValues.length) p.predict_values = predictValues;
  const unknown = form.elements.partitions_unknown_policy?.value || "train";
  if (unknown !== "train") p.unknown_policy = unknown;
  applyPartitionTarget(p, "train", form.elements.partitions_train?.value);
  applyPartitionTarget(p, "test", form.elements.partitions_test?.value);
  applyPartitionTarget(p, "predict", form.elements.partitions_predict?.value);
  if (Object.keys(p).length) spec.partitions = p; else delete spec.partitions;
}

function applyPartitionTarget(p, key, raw) {
  const text = String(raw || "").trim();
  if (!text) return;
  if (/\.([a-z0-9]+)$/i.test(text) && !text.startsWith("[") && !text.startsWith("{")) {
    p[`${key}_file`] = text;
  } else {
    p[key] = parseLooseValue(text);
  }
}

function applyFoldsFromForm(spec, form) {
  const folds = {};
  setString(folds, "file", form.elements.folds_file?.value);
  setString(folds, "column", form.elements.folds_column?.value);
  if (folds.file) folds.format = form.elements.folds_format?.value || "auto";
  const inline = parseOptionalJson(form.elements.folds_inline?.value, "folds.inline");
  if (inline != null) {
    if (!Array.isArray(inline)) throw new Error("folds.inline must be a JSON array");
    folds.inline = inline;
  }
  if (Object.keys(folds).length) spec.folds = folds; else delete spec.folds;
}

function applyGlobalSpecFieldsFromForm(spec, form) {
  const conventions = parseOptionalJson(form.elements.conventions_json?.value, "conventions");
  if (conventions != null) {
    if (!Array.isArray(conventions)) throw new Error("conventions must be a JSON array");
    spec.conventions = conventions;
  } else {
    delete spec.conventions;
  }

  const params = parseOptionalJson(form.elements.global_params_json?.value, "global params");
  if (params != null) {
    if (!params || Array.isArray(params) || typeof params !== "object") throw new Error("global params must be a JSON object");
    spec.params = params;
  } else {
    delete spec.params;
  }

  const validation = {};
  if (form.elements.validation_check_file_existence?.value === "false") validation.check_file_existence = false;
  if (form.elements.validation_allow_train_only?.value === "false") validation.allow_train_only = false;
  if (form.elements.validation_allow_test_only?.value === "false") validation.allow_test_only = false;
  if (Object.keys(validation).length) spec.validation = validation; else delete spec.validation;
}

function sourceFromRow(row, index) {
  const get = (name) => row.querySelector(`[name="${name}"]`)?.value || "";
  const src = {
    id: get("source_id") || `source_${index + 1}`,
    role: get("source_role") || "features",
  };
  const kind = get("source_kind") || "table";
  if (kind !== "table") src.kind = kind;
  setString(src, "modality", get("source_modality"));
  const input = parseInputList(get("source_input"));
  if (input) src.input = input;
  const merge = get("source_merge");
  if (merge) src.merge = merge;
  setString(src, "partition", get("source_partition"));
  const key = get("source_key").trim();
  if (key) src.key = parseLooseValue(key);
  if (get("source_strict_columns") === "false") src.strict_columns = false;

  const params = sourceParamsFromRow(row);
  if (Object.keys(params).length) src.params = params;

  const columns = parseOptionalJson(get("source_columns"), `source '${src.id}' columns`);
  if (columns != null) src.columns = columns;

  const join = sourceJoinFromRow(row, src.id);
  if (join) src.join = join;

  const variations = parseOptionalJson(get("source_variations"), `source '${src.id}' variations`);
  if (variations != null) {
    if (!Array.isArray(variations)) throw new Error(`source '${src.id}' variations must be a JSON array`);
    src.variations = variations;
  }
  return src;
}

function sourceParamsFromRow(row) {
  const get = (name) => row.querySelector(`[name="${name}"]`)?.value || "";
  const params = {};
  setString(params, "delimiter", get("source_delimiter"));
  setString(params, "decimal_separator", get("source_decimal"));
  const header = get("source_header");
  if (header) params.has_header = header === "true";
  setString(params, "header_unit", get("source_header_unit"));
  setString(params, "signal_type", get("source_signal_type"));
  setString(params, "encoding", get("source_encoding"));
  const naPolicy = get("source_na_policy");
  if (naPolicy && naPolicy !== "auto") params.na = { policy: naPolicy };
  setString(params, "categorical", get("source_categorical"));
  const format = parseOptionalJson(get("source_format_json"), "params.format");
  if (format != null) {
    if (!format || Array.isArray(format) || typeof format !== "object") throw new Error("params.format must be a JSON object");
    params.format = format;
  }
  return params;
}

function sourceJoinFromRow(row, sourceId) {
  const get = (name) => row.querySelector(`[name="${name}"]`)?.value || "";
  const right = get("source_join_right").trim();
  const left = get("source_join_left").trim();
  const leftOn = get("source_join_left_on").trim();
  const rightOn = get("source_join_right_on").trim();
  const any = right || left || leftOn || rightOn;
  if (!any) return null;
  if (!right) throw new Error(`source '${sourceId}' join.right is required`);
  const join = { right };
  if (left) join.left = left;
  if (leftOn) join.left_on = parseLooseValue(leftOn);
  if (rightOn) join.right_on = parseLooseValue(rightOn);
  join.cardinality = get("source_join_cardinality") || "1:1";
  join.coverage = get("source_join_coverage") || "complete";
  return join;
}

function refreshSpecDrivenViews() {
  renderKpis();
  renderDatasetMap();
  renderDatasetAlerts();
  renderFiles();
  renderTargetSelect();
  renderSignalSelect();
  renderVizTabs();
  renderValidationBadge();
  setStatus(datasetStatus());
  drawViz();
}

function parseInputList(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (raw.startsWith("[")) return parseLooseValue(raw);
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : parts[0] || "";
}

function validateSpec() {
  if (!io?.validate || !state.spec) {
    state.validation = state.spec ? { ok: true, message: "local edit" } : null;
    return;
  }
  try {
    io.validate(JSON.stringify(state.spec));
    state.validation = { ok: true, message: "valid" };
  } catch (err) {
    state.validation = { ok: false, message: err.message || String(err) };
  }
}

function renderValidationBadge() {
  const badge = $("#validationBadge");
  if (!state.validation) {
    badge.textContent = "not validated";
    badge.className = "pill";
  } else if (state.validation.ok) {
    badge.textContent = state.validation.message;
    badge.className = "pill ok";
  } else {
    badge.textContent = "invalid";
    badge.title = state.validation.message;
    badge.className = "pill err";
  }
}

function datasetView() {
  const ok = state.decoded.filter((d) => d.ok);
  const records = ok.flatMap((d) => d.records.map((r) => ({ ...r, __file: d.file })));
  const targets = targetPreview();
  const decodedTargetKeys = [];
  for (const record of records) {
    for (const key of Object.keys(record.targets || {})) {
      if (!decodedTargetKeys.includes(key)) decodedTargetKeys.push(key);
    }
  }
  const targetKeys = [...decodedTargetKeys, ...targets.keys.filter((key) => !decodedTargetKeys.includes(key))];
  const activeTarget = targetKeys.includes(state.activeTarget) ? state.activeTarget : targetKeys[0] || "";
  const signals = [];
  for (const record of records) {
    for (const name of Object.keys(record.signals || {})) {
      if (!signals.includes(name)) signals.push(name);
    }
  }
  const signal = state.activeSignal || signals[0] || "";
  const rows = records.map((record, i) => {
    const arr = record.signals?.[signal] || Object.values(record.signals || {})[0];
    const values = (arr?.values || []).map(Number).filter(Number.isFinite);
    const axis = (arr?.axis?.values || []).map(Number).filter(Number.isFinite);
    const targetEntries = Object.entries(record.targets || {});
    const recordTarget = activeTarget && Object.prototype.hasOwnProperty.call(record.targets || {}, activeTarget)
      ? [activeTarget, record.targets[activeTarget]]
      : !activeTarget && targetEntries.length
        ? targetEntries[0]
        : null;
    const rowIndex = Number(record.metadata?.row_index ?? i);
    const partition = record.metadata?.partition || sourcePartition(record.__file) || "";
    const previewTarget = recordTarget ? null : targets.find(record, record.__file, rowIndex, partition, activeTarget);
    const targetKey = recordTarget?.[0] || previewTarget?.key || "";
    const target = recordTarget?.[1] ?? previewTarget?.value;
    return {
      index: i,
      record,
      values,
      axis,
      rowIndex,
      targetKey,
      target,
      targetSource: previewTarget?.source || "",
      partition,
      metadata: record.metadata || {},
      file: record.__file,
      signal: arr,
    };
  }).filter((r) => r.values.length);
  const first = rows[0] || null;
  return {
    records,
    rows,
    signals,
    signal,
    axis: first?.axis || [],
    axisUnit: first?.signal?.axis?.unit || "",
    maxFeatures: rows.reduce((m, r) => Math.max(m, r.values.length), 0),
    targetKey: activeTarget || rows.find((r) => r.targetKey)?.targetKey || targets.keys[0] || "",
    targetKeys,
    targetValues: rows.filter((r) => r.target != null).map((r) => ({ key: r.targetKey, value: r.target, row: r })),
    targetPreviewValues: targets.values.filter((item) => !activeTarget || item.key === activeTarget),
  };
}

function targetPreview() {
  const spec = state.spec || state.plan?.resolved_spec || {};
  const sources = spec.sources || [];
  const byId = new Map(sources.map((src) => [src.id, src]));
  const byFileRow = new Map();
  const byPartitionRow = new Map();
  const bySampleId = new Map();
  const values = [];
  const keys = [];

  for (const src of sources) {
    if (src.role !== "targets") continue;
    for (const input of asInputList(src.input)) {
      const file = state.files.find((f) => f.name === input || baseName(f.name) === input);
      if (!file) continue;
      const table = parsePreviewTable(file, src.params || {});
      if (!table.rows.length) continue;
      const targetCols = chooseTargetColumns(table);
      if (!targetCols.length) continue;
      const idCol = chooseIdColumn(table);
      const linked = byId.get(src.join?.right);
      const linkedInputs = linked ? asInputList(linked.input) : [];
      table.rows.forEach((row, rowIndex) => {
        for (const targetCol of targetCols) {
          if (!keys.includes(targetCol)) keys.push(targetCol);
          const raw = row[targetCol];
          if (raw == null || String(raw).trim() === "") continue;
          const numeric = Number(String(raw).replace(",", "."));
          const value = Number.isFinite(numeric) ? numeric : raw;
          const item = {
            key: targetCol,
            value,
            rowIndex,
            partition: src.partition || linked?.partition || "",
            source: src.id || input,
            sampleId: idCol ? String(row[idCol] ?? "") : "",
          };
          values.push(item);
          if (item.sampleId) addAligned(bySampleId, item.sampleId, item);
          for (const linkedInput of linkedInputs) addAligned(byFileRow, rowKey(linkedInput, rowIndex), item);
          if (item.partition) addAligned(byPartitionRow, rowKey(item.partition, rowIndex), item);
        }
      });
    }
  }

  return {
    keys,
    values,
    find(record, file, rowIndex, partition, key) {
      const sampleId = record.metadata?.sample_id || record.metadata?.id || "";
      if (sampleId) {
        const found = pickAligned(bySampleId.get(String(sampleId)), key);
        if (found) return found;
      }
      return pickAligned(byFileRow.get(rowKey(file, rowIndex)), key)
        || pickAligned(byFileRow.get(rowKey(baseName(file), rowIndex)), key)
        || pickAligned(byPartitionRow.get(rowKey(partition, rowIndex)), key)
        || null;
    },
  };
}

function addAligned(map, key, item) {
  const id = String(key || "");
  const bucket = map.get(id) || new Map();
  bucket.set(item.key, item);
  map.set(id, bucket);
}

function pickAligned(bucket, key) {
  if (!bucket) return null;
  if (key && bucket.has(key)) return bucket.get(key);
  return bucket.values().next().value || null;
}

function rowKey(name, rowIndex) {
  return `${name || ""}\u0000${Number.isFinite(rowIndex) ? rowIndex : ""}`;
}

function asInputList(input) {
  if (Array.isArray(input)) return input.filter(Boolean);
  return input ? [input] : [];
}

function parsePreviewTable(file, params) {
  const text = new TextDecoder().decode(file.bytes);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const delimiter = previewDelimiter(lines, params?.delimiter);
  const split = (line) => delimiter ? line.split(delimiter).map((s) => s.trim()) : [line.trim()];
  const first = split(lines[0]);
  const second = lines[1] ? split(lines[1]) : [];
  const hasHeader = params?.has_header !== false && first.some((cell, i) => !isNumericCell(cell) && isNumericCell(second[i] ?? ""));
  const headers = hasHeader ? first : first.map((_, i) => i === 0 ? "target" : `col_${i + 1}`);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows = dataLines.map((line) => {
    const cells = split(line);
    const row = {};
    headers.forEach((header, i) => { row[header || `col_${i + 1}`] = cells[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

function previewDelimiter(lines, declared) {
  const first = lines[0] || "";
  if (declared && first.includes(declared)) return declared;
  const candidates = [";", "\t", ","];
  const scored = candidates.map((d) => [d, first.split(d).length - 1]).sort((a, b) => b[1] - a[1]);
  return scored[0][1] > 0 ? scored[0][0] : "";
}

function chooseTargetColumns(table) {
  const candidates = table.headers.filter((h) => h && !isIdColumn(h));
  const cols = candidates.length ? candidates : table.headers.filter(Boolean);
  const numeric = cols.filter((h) => table.rows.some((row) => isNumericCell(row[h])));
  return [...numeric, ...cols.filter((h) => !numeric.includes(h))];
}

function chooseIdColumn(table) {
  return table.headers.find(isIdColumn) || "";
}

function isIdColumn(name) {
  return /^(sample[_ ]?id|sampleid|sample|id|name|code|ref(erence)?|key|index|.*_id|id_.*)$/i.test(String(name || ""));
}

function isNumericCell(value) {
  if (value == null || String(value).trim() === "") return false;
  return Number.isFinite(Number(String(value).replace(",", ".")));
}

function sourcePartition(fileName) {
  const src = (state.spec?.sources || []).find((s) => {
    const input = Array.isArray(s.input) ? s.input : [s.input];
    return input.includes(fileName);
  });
  return src?.partition || "";
}

function sourceForFile(fileName) {
  const sources = state.spec?.sources || state.plan?.resolved_spec?.sources || [];
  return sources.find((s) => asInputList(s.input).some((input) => input === fileName || input === baseName(fileName))) || null;
}

function chooseDefaultSignal() {
  const view = datasetView();
  if (!state.activeSignal || !view.signals.includes(state.activeSignal)) {
    state.activeSignal = view.signals[0] || "";
  }
}

function chooseDefaultTarget() {
  const view = datasetView();
  if (!view.targetKeys.length) {
    state.activeTarget = "";
  } else if (!state.activeTarget || !view.targetKeys.includes(state.activeTarget)) {
    state.activeTarget = view.targetKey || view.targetKeys[0];
  }
}

function drawViz() {
  const canvas = $("#vizCanvas");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, rect.width, rect.height);
  const view = datasetView();
  if (!view.rows.length && state.activeViz !== "targets") {
    drawEmpty(ctx, rect.width, rect.height);
    return;
  }
  if (state.activeViz === "heatmap") drawHeatmap(ctx, rect.width, rect.height, view);
  else if (state.activeViz === "scatter") drawScatter(ctx, rect.width, rect.height, view);
  else if (state.activeViz === "targets") drawTargets(ctx, rect.width, rect.height, view);
  else drawSpectra(ctx, rect.width, rect.height, view);
}

function drawEmpty(ctx, w, h) {
  ctx.fillStyle = "#64748b";
  ctx.font = "500 14px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Decoded spectra will appear here.", w / 2, h / 2);
  $("#legend").innerHTML = "";
}

function plotBox(w, h) {
  return { x: 54, y: 24, w: Math.max(1, w - 78), h: Math.max(1, h - 64) };
}

function drawAxes(ctx, box, xLabel, yLabel) {
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y);
  ctx.lineTo(box.x, box.y + box.h);
  ctx.lineTo(box.x + box.w, box.y + box.h);
  ctx.stroke();
  ctx.fillStyle = "#64748b";
  ctx.font = "11px JetBrains Mono, monospace";
  ctx.textAlign = "center";
  ctx.fillText(xLabel, box.x + box.w / 2, box.y + box.h + 34);
  ctx.save();
  ctx.translate(14, box.y + box.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function drawSpectra(ctx, w, h, view) {
  const rows = view.rows.slice(0, state.sampleLimit);
  if (!rows.length) {
    drawEmpty(ctx, w, h);
    return;
  }
  const box = plotBox(w, h);
  const xvals = view.axis.length ? view.axis : rows[0].values.map((_, i) => i);
  const [ymin, ymax] = rowValueExtent(rows);
  const [xmin, xmax] = valueExtent(xvals);
  const sx = (x) => box.x + ((x - xmin) / (xmax - xmin || 1)) * box.w;
  const sy = (y) => box.y + box.h - ((y - ymin) / (ymax - ymin || 1)) * box.h;
  drawAxes(ctx, box, view.axisUnit ? `axis (${view.axisUnit})` : "feature", "signal");

  const stats = columnStats(rows.map((r) => r.values));
  if (stats.mean.length) {
    ctx.fillStyle = "rgba(13,148,136,.10)";
    ctx.beginPath();
    stats.max.forEach((v, i) => {
      const x = sx(xvals[i] ?? i), y = sy(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    for (let i = stats.min.length - 1; i >= 0; i--) ctx.lineTo(sx(xvals[i] ?? i), sy(stats.min[i]));
    ctx.closePath();
    ctx.fill();
  }
  rows.forEach((row, i) => {
    ctx.strokeStyle = colorFor(row, i);
    ctx.globalAlpha = .18;
    ctx.lineWidth = 1;
    line(ctx, row.values, xvals, sx, sy);
  });
  ctx.globalAlpha = 1;
  if (stats.mean.length) {
    ctx.strokeStyle = "#0f766e";
    ctx.lineWidth = 2.2;
    line(ctx, stats.mean, xvals, sx, sy);
  }
  $("#legend").innerHTML = `<span class="legend-item"><span class="sw" style="background:#0f766e"></span>mean</span><span class="legend-item"><span class="sw" style="background:rgba(13,148,136,.2)"></span>min-max</span><span>${fmtInt(rows.length)} displayed / ${fmtInt(view.rows.length)} records</span>`;
}

function drawHeatmap(ctx, w, h, view) {
  const rows = view.rows.slice(0, Math.min(state.sampleLimit, 260));
  const box = plotBox(w, h);
  drawAxes(ctx, box, "features", "samples");
  const nRows = rows.length;
  const nCols = Math.min(view.maxFeatures, 360);
  const stride = Math.max(1, Math.floor(view.maxFeatures / nCols));
  const vals = rows.flatMap((r) => r.values.filter(Number.isFinite));
  const lo = percentile(vals, .02), hi = percentile(vals, .98);
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const v = rows[r].values[c * stride];
      ctx.fillStyle = heatColor((v - lo) / (hi - lo || 1));
      ctx.fillRect(box.x + c * box.w / nCols, box.y + r * box.h / nRows, Math.ceil(box.w / nCols), Math.ceil(box.h / nRows));
    }
  }
  $("#legend").innerHTML = `<span class="legend-item"><span class="sw" style="background:#4f46e5"></span>low</span><span class="legend-item"><span class="sw" style="background:#d97706"></span>high</span><span>${fmtInt(nRows)} samples x ${fmtInt(nCols)} displayed bins</span>`;
}

function drawScatter(ctx, w, h, view) {
  const rows = view.rows.slice(0, state.sampleLimit).map((row) => {
    const mean = avg(row.values);
    const slope = row.values.length > 1 ? row.values[row.values.length - 1] - row.values[0] : 0;
    return { ...row, px: mean, py: slope };
  });
  const box = plotBox(w, h);
  const xmin = Math.min(...rows.map((r) => r.px)), xmax = Math.max(...rows.map((r) => r.px));
  const ymin = Math.min(...rows.map((r) => r.py)), ymax = Math.max(...rows.map((r) => r.py));
  const sx = (x) => box.x + ((x - xmin) / (xmax - xmin || 1)) * box.w;
  const sy = (y) => box.y + box.h - ((y - ymin) / (ymax - ymin || 1)) * box.h;
  drawAxes(ctx, box, "mean signal", "end-start");
  rows.forEach((row, i) => {
    ctx.fillStyle = colorFor(row, i);
    ctx.globalAlpha = .82;
    ctx.beginPath();
    ctx.arc(sx(row.px), sy(row.py), 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  $("#legend").innerHTML = legendFor(rows);
}

function drawTargets(ctx, w, h, view) {
  const rows = view.rows.filter((r) => r.target != null);
  const samples = rows.length
    ? rows.map((r) => ({ key: r.targetKey, value: r.target, aligned: true }))
    : view.targetPreviewValues.map((item) => ({ key: item.key, value: item.value, aligned: false }));
  const box = plotBox(w, h);
  if (!samples.length) {
    drawAxes(ctx, box, view.targetKey || "target", "count");
    ctx.fillStyle = "#64748b";
    ctx.font = "500 13px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No y values detected for the selected target.", box.x + box.w / 2, box.y + box.h / 2);
    $("#legend").innerHTML = "No target source detected by nirs4all-io.";
    return;
  }
  const numeric = samples.map((r) => Number(r.value)).filter(Number.isFinite);
  const label = view.targetKey || samples.find((r) => r.key)?.key || "y";
  const aligned = samples.some((sample) => sample.aligned);
  const scope = aligned ? "aligned with spectra" : "detected in y source";
  drawAxes(ctx, box, label, "count");
  if (numeric.length >= Math.max(3, samples.length * .7)) {
    const bins = Math.max(3, Math.min(18, Math.ceil(Math.sqrt(numeric.length) * 1.6)));
    const lo = Math.min(...numeric), hi = Math.max(...numeric);
    const counts = Array.from({ length: bins }, () => 0);
    numeric.forEach((v) => {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo || 1)) * bins)));
      counts[idx]++;
    });
    const max = Math.max(...counts, 1);
    ctx.strokeStyle = "#e2e8f0";
    ctx.fillStyle = "#64748b";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    for (let t = 0; t <= max; t += Math.max(1, Math.ceil(max / 4))) {
      const y = box.y + box.h - (t / max) * box.h;
      ctx.globalAlpha = t === 0 ? 1 : .75;
      ctx.beginPath();
      ctx.moveTo(box.x, y);
      ctx.lineTo(box.x + box.w, y);
      ctx.stroke();
      if (t > 0) ctx.fillText(String(t), box.x - 8, y + 4);
    }
    ctx.globalAlpha = 1;
    counts.forEach((count, i) => {
      const x = box.x + i * box.w / bins;
      const bh = (count / max) * box.h;
      ctx.fillStyle = "#0d9488";
      ctx.fillRect(x + 3, box.y + box.h - bh, Math.max(2, box.w / bins - 6), bh);
      if (count > 0) {
        ctx.fillStyle = "#0f172a";
        ctx.font = "11px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(count), x + box.w / bins / 2, box.y + box.h - bh - 5);
      }
    });
    ctx.fillStyle = "#64748b";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText(fmtNum(lo, 4), box.x, box.y + box.h + 18);
    ctx.textAlign = "center";
    ctx.fillText(fmtNum((lo + hi) / 2, 4), box.x + box.w / 2, box.y + box.h + 18);
    ctx.textAlign = "right";
    ctx.fillText(fmtNum(hi, 4), box.x + box.w, box.y + box.h + 18);
    const mean = avg(numeric);
    $("#legend").innerHTML = `<span class="legend-item"><span class="sw" style="background:#0d9488"></span>${esc(label)}</span><span>${fmtInt(numeric.length)} values</span><span>${esc(scope)}</span><span>min ${fmtNum(lo, 4)}</span><span>mean ${fmtNum(mean, 4)}</span><span>max ${fmtNum(hi, 4)}</span>`;
  } else {
    const counts = new Map();
    samples.forEach((r) => counts.set(String(r.value), (counts.get(String(r.value)) || 0) + 1));
    const entries = [...counts.entries()].slice(0, 20);
    const max = Math.max(...entries.map((e) => e[1]), 1);
    entries.forEach(([name, count], i) => {
      const y = box.y + i * (box.h / entries.length);
      const bw = (count / max) * box.w;
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fillRect(box.x, y + 3, bw, Math.max(3, box.h / entries.length - 6));
      ctx.fillStyle = "#0f172a";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.fillText(name.slice(0, 22), box.x + 6, y + 16);
    });
    $("#legend").innerHTML = `<span>${fmtInt(samples.length)} categorical y values from ${esc(label)}</span><span>${esc(scope)}</span>`;
  }
}

function line(ctx, values, xvals, sx, sy) {
  ctx.beginPath();
  let started = false;
  values.forEach((v, i) => {
    const x = sx(xvals[i] ?? i), y = sy(v);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      started = false;
      return;
    }
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

function rowValueExtent(rows) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of rows) {
    for (const value of row.values) {
      if (!Number.isFinite(value)) continue;
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : [0, 1];
}

function valueExtent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : [0, 1];
}

function columnStats(rows) {
  const n = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const mean = [], min = [], max = [];
  for (let c = 0; c < n; c++) {
    const vals = rows.map((r) => r[c]).filter(Number.isFinite);
    if (!vals.length) continue;
    mean[c] = avg(vals);
    min[c] = Math.min(...vals);
    max[c] = Math.max(...vals);
  }
  return { mean, min, max };
}

function colorFor(row, i) {
  if (state.colorBy === "partition") return colorToken(row.partition || "none");
  if (state.colorBy === "index") return PALETTE[i % PALETTE.length];
  return colorToken(String(row.target ?? "none"));
}

function colorToken(token) {
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function legendFor(rows) {
  const tokens = [...new Set(rows.map((r) => state.colorBy === "partition" ? (r.partition || "none") : String(r.target ?? "none")))].slice(0, 8);
  return tokens.map((t) => `<span class="legend-item"><span class="sw" style="background:${colorToken(t)}"></span>${esc(t)}</span>`).join("");
}

function heatColor(t) {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.round(79 + x * 138);
  const g = Math.round(70 + x * 49);
  const b = Math.round(229 - x * 210);
  return `rgb(${r},${g},${b})`;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
}

function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

function numericStats(values) {
  const vals = values.filter(Number.isFinite);
  if (!vals.length) return { n: 0, min: NaN, mean: NaN, max: NaN };
  return {
    n: vals.length,
    min: Math.min(...vals),
    mean: avg(vals),
    max: Math.max(...vals),
  };
}

function sidecarUsage() {
  const used = new Set();
  for (const file of state.files) {
    for (const req of file.sidecars || []) {
      const found = findSidecar(req, file);
      if (found && shouldPreferPrimaryOverSidecar(file, found, req)) used.add(found.name);
    }
  }
  return used;
}

function shouldPreferPrimaryOverSidecar(primary, sidecar, req) {
  const role = String(req?.role || "");
  const primaryExt = extOf(primary.name);
  const sidecarExt = extOf(sidecar.name);
  if ((role === "header_sidecar" || role === "header") && sidecarExt === "hdr") return false;
  if (role === "binary_sidecar" || role === "binary" || role === "data_sidecar" || role === "data") return primaryExt === "hdr";
  if (role === "hdf5_payload") return primaryExt === "xml";
  return true;
}

function missingRequired(file) {
  return (file.sidecars || []).filter((req) => req.required && !findSidecar(req, file));
}

function sidecarPresent(req) {
  return state.files.some((file) => sidecarMatches(req, file.name));
}

function findSidecar(req, primary) {
  return state.files.find((file) => file !== primary && sidecarMatches(req, file.name));
}

function sidecarMatches(req, fileName) {
  const names = new Set([req.path, ...(req.alternatives || [])].filter(Boolean));
  const candidates = new Set([
    fileName,
    baseName(fileName),
    fileName.toLowerCase(),
    baseName(fileName).toLowerCase(),
  ]);
  for (const name of names) {
    if (candidates.has(name) || candidates.has(String(name).toLowerCase())) return true;
  }
  return false;
}

function buildSidecarMap(primary) {
  const out = {};
  for (const req of primary.sidecars || []) {
    const file = findSidecar(req, primary);
    if (!file) continue;
    for (const key of sidecarKeys(req, file, primary)) out[key] = file.bytes;
  }
  return out;
}

function sidecarKeys(req, file, primary) {
  const raw = file.name.replace(/\\/g, "/");
  const rel = dirName(primary.name) && raw.startsWith(dirName(primary.name)) ? raw.slice(dirName(primary.name).length) : raw;
  const keys = new Set([raw, rel, baseName(raw), req.path, ...(req.alternatives || [])].filter(Boolean));
  for (const key of [...keys]) {
    keys.add(key.replace(/\.([^.\\/]+)$/, (_, ext) => "." + ext.toLowerCase()));
    keys.add(key.replace(/\.([^.\\/]+)$/, (_, ext) => "." + ext.toUpperCase()));
  }
  return [...keys];
}

function bytesTotal() {
  return fmtBytes(state.files.reduce((sum, file) => sum + (file.size || file.bytes.length), 0));
}

function fmtBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 10 || u === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`;
}

function safeFileStem(name) {
  return String(name || "dataset").trim().replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "dataset";
}

function setStatus(text) {
  $("#status").textContent = text;
}

function datasetStatus() {
  if (!state.files.length) return "Waiting for files.";
  const refusals = nonSpectralRefusals();
  const failures = formatDecodeFailures();
  const exclusions = inferenceExclusions();
  if (exclusions.length === state.files.length) {
    if (refusals.length === state.files.length) {
      return `${state.files.length} file${state.files.length > 1 ? "s" : ""} loaded, but no wavelength-indexed spectra were detected.`;
    }
    return `${state.files.length} file${state.files.length > 1 ? "s" : ""} loaded, but nirs4all-formats could not decode ${state.files.length > 1 ? "them" : "it"} in this browser build.`;
  }
  if (refusals.length === state.files.length) {
    return `${state.files.length} file${state.files.length > 1 ? "s" : ""} loaded, but no wavelength-indexed spectra were detected.`;
  }
  const missing = missingSidecarAlerts();
  if (missing.length) {
    const names = missing.map((item) => item.path).slice(0, 3).join(", ");
    const more = missing.length > 3 ? `, +${missing.length - 3} more` : "";
    return `${missing.length} required companion file${missing.length > 1 ? "s" : ""} missing: ${names}${more}.`;
  }
  const structure = decisionLabel(state.plan?.structure?.value || "unknown");
  const score = state.plan?.overall_score == null ? "" : `, io score ${fmtNum(state.plan.overall_score, 3)}`;
  const excluded = exclusions.length
    ? ` ${fmtInt(exclusions.length)} file${exclusions.length > 1 ? "s" : ""} excluded from X inference${failures.length ? ` (${fmtInt(failures.length)} decode failure${failures.length > 1 ? "s" : ""})` : ""}.`
    : "";
  return `${state.files.length} file${state.files.length > 1 ? "s" : ""} loaded. Structure: ${structure}${score}.${excluded}`;
}
