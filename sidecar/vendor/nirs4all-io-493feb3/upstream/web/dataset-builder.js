/*
 * io.nirs4all.org — Dataset Builder demo glue (vanilla ES module, no build).
 *
 * Parses dropped/selected CSV/TSV files into the `DatasetSource` descriptor
 * shape expected by the reusable `nirs4all-ui/datasetBuilder` component, then
 * mounts the React wizard (pre-bundled at ./vendor/dataset-builder.mjs). The
 * component owns all wizard logic + auto-detection; this file only does file
 * reading, generic CSV parsing, and wiring. Heavy vendor formats (OPUS, SPC,
 * JCAMP, …) would route through the nirs4all-formats WASM reader already shipped
 * on this site; CSV is parsed here directly since the builder needs every
 * column generically, not just spectra.
 */
import { render, detect } from "./vendor/dataset-builder.mjs";

const root = document.getElementById("builder-root");
const overlay = document.getElementById("export-overlay");
const overlayJson = document.getElementById("export-json");
const fileInput = document.getElementById("file-input");

/** @type {Array<object>} live source list (controlled mode). */
let sources = [];
let counter = 0;

// --- CSV parsing ------------------------------------------------------------

function detectSeparator(line) {
  const candidates = [";", ",", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const sep of candidates) {
    const count = line.split(sep).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = sep;
    }
  }
  return best;
}

function splitLine(line, sep) {
  return line.split(sep).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

const INT_RE = /^-?\d+$/;
const FLOAT_RE = /^-?\d*[.,]?\d+(e-?\d+)?$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
const BOOL_RE = /^(true|false|yes|no|0|1)$/i;

function detectType(values) {
  const sample = values.filter((v) => v !== "" && v != null).slice(0, 24);
  if (sample.length === 0) return "unknown";
  if (sample.every((v) => INT_RE.test(v))) return "integer";
  if (sample.every((v) => FLOAT_RE.test(v))) return "float";
  if (sample.every((v) => DATE_RE.test(v))) return "date";
  if (sample.every((v) => BOOL_RE.test(v))) return "boolean";
  return "text";
}

function parseCsv(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [], separator: "," };
  const separator = detectSeparator(lines[0]);
  const header = splitLine(lines[0], separator);
  const rows = lines.slice(1).map((l) => splitLine(l, separator));
  return { header, rows, separator };
}

function fileExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Guess how a source is used from its filename (X/Y/metadata × train/test). */
function guessUseAs(name) {
  const n = name.toLowerCase();
  const test = /test|prediction|valid/.test(n);
  if (/meta/.test(n)) return test ? "metadata_train_test" : "metadata";
  if (/(^|[_\-])y|target|label|protein|trait/.test(n)) return test ? "y_test" : "y_train";
  if (/x|spectra|nir|wave/.test(n)) return test ? "x_test" : "x_train";
  return undefined;
}

function makeSource(name, text) {
  const { header, rows, separator } = parseCsv(text);
  const ext = fileExtension(name) || "csv";
  const seen = new Map();
  const columns = header.map((rawName, index) => {
    let id = rawName || `col_${index}`;
    if (seen.has(id)) {
      const n = seen.get(id) + 1;
      seen.set(id, n);
      id = `${id}__${n}`;
    } else {
      seen.set(id, 0);
    }
    const columnValues = rows.map((r) => r[index]);
    return {
      id,
      name: rawName || `col_${index}`,
      previewValue: columnValues.find((v) => v !== "" && v != null) ?? null,
      detectedType: detectType(columnValues),
      assignedRole: "ignored",
    };
  });
  counter += 1;
  // Let the package's pure engine infer signal type + column roles.
  return detect({
    id: `src_${counter}`,
    name,
    kind: "file",
    fileType: ext,
    signalType: "other",
    status: "parsed",
    rowCount: rows.length,
    columnCount: columns.length,
    sizeBytes: new Blob([text]).size,
    parsing: { separator, decimal: ".", headerMode: "horizontal" },
    usage: { useAs: guessUseAs(name) },
    columns,
  });
}

// --- mounting ---------------------------------------------------------------

function mount() {
  render(root, {
    sources,
    datasetName: "demo_dataset",
    locale: "fr",
    onChange: (next) => {
      sources = next;
      mount();
    },
    onRequestAddSource: () => fileInput.click(),
    onExport: (config) => {
      overlayJson.textContent = JSON.stringify(config, null, 2);
      overlay.hidden = false;
    },
  });
}

// --- file intake ------------------------------------------------------------

async function addFiles(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    const ext = fileExtension(file.name);
    if (["csv", "tsv", "txt"].includes(ext) || !ext) {
      const text = await file.text();
      sources = [...sources, makeSource(file.name, text)];
    } else {
      // Non-CSV vendor formats would be decoded by the nirs4all-formats WASM
      // reader; unsupported here in the lightweight demo path.
      sources = [
        ...sources,
        {
          ...makeSource(file.name, ""),
          fileType: ext,
          status: "warning",
          notes: [`Format .${ext} : lecture via nirs4all-formats WASM non branchée dans cette démo.`],
        },
      ];
    }
  }
  mount();
}

async function loadSamples() {
  let manifest;
  try {
    manifest = await (await fetch("./samples/manifest.json")).json();
  } catch {
    return;
  }
  for (const entry of manifest.files) {
    try {
      const text = await (await fetch(`./samples/${entry.name}`)).text();
      sources = [...sources, makeSource(entry.name, text)];
    } catch {
      /* ignore missing sample */
    }
  }
  mount();
}

// --- events -----------------------------------------------------------------

fileInput.addEventListener("change", (e) => {
  if (e.target.files) addFiles(e.target.files);
  e.target.value = "";
});

document.getElementById("load-samples").addEventListener("click", loadSamples);
document.getElementById("reset").addEventListener("click", () => {
  sources = [];
  mount();
});
document.getElementById("export-close").addEventListener("click", () => {
  overlay.hidden = true;
});
document.getElementById("export-download").addEventListener("click", () => {
  const blob = new Blob([overlayJson.textContent], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "dataset-config.json";
  a.click();
  URL.revokeObjectURL(url);
});

["dragover", "dragenter"].forEach((type) =>
  document.body.addEventListener(type, (e) => {
    e.preventDefault();
    document.body.classList.add("dragging");
  }),
);
["dragleave", "drop"].forEach((type) =>
  document.body.addEventListener(type, (e) => {
    e.preventDefault();
    if (type === "drop" && e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    document.body.classList.remove("dragging");
  }),
);

mount();

// Convenience: `dataset-builder.html#demo` auto-loads the sample dataset.
if (location.hash.includes("demo")) loadSamples();
