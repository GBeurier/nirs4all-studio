import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");
const workspace = path.resolve(root, "..", "..");
const formatsRoot = process.env.N4IO_FORMATS_ROOT || path.join(workspace, "nirs4all-formats");
const standalone = pathToFileURL(path.join(root, "dist", "nirs4all-io-standalone.html")).href;
const chromeExecutable = process.env.CHROME_BIN || "/usr/bin/google-chrome";
const workers = Number.parseInt(process.env.NIRS4ALL_ALL_SAMPLES_WORKERS || "3", 10);
const strictDecode = process.env.NIRS4ALL_ALL_SAMPLES_STRICT === "1";
const caseLimit = Number.parseInt(process.env.NIRS4ALL_ALL_SAMPLES_LIMIT || "0", 10);
const perCaseTimeoutMs = Number.parseInt(process.env.NIRS4ALL_ALL_SAMPLES_TIMEOUT_MS || "45000", 10);

const sampleDirNames = ["samples", "samples_local", "local_samples", "new_samples"];
const sampleDirs = sampleDirNames
  .map((name) => path.join(formatsRoot, name))
  .filter((directory) => fs.existsSync(directory));

if (!sampleDirs.length) {
  throw new Error(`No sample directories found under ${formatsRoot}`);
}

async function loadPlaywright() {
  const moduleName = process.env.PLAYWRIGHT_MODULE || "playwright";
  const specifier = moduleName.startsWith("/") ? pathToFileURL(moduleName).href : moduleName;
  return import(specifier);
}

const cases = discoverCases();
const selectedCases = caseLimit > 0 ? cases.slice(0, caseLimit) : cases;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
  args: ["--allow-file-access-from-files"],
});

const failures = [];
const summary = new Map();

try {
  await Promise.all(
    Array.from({ length: Math.max(1, workers) }, (_, workerIndex) => runWorker(workerIndex)),
  );

  if (failures.length) {
    const rendered = failures
      .slice(0, 40)
      .map((failure) => {
        const files = failure.files.map((file) => path.relative(formatsRoot, file)).join(", ");
        return `- ${failure.label}: ${failure.reason}\n  files: ${files}\n  status: ${failure.state?.status || ""}\n  alerts: ${failure.state?.alerts || ""}`;
      })
      .join("\n");
    throw new Error(`all-samples standalone audit failed for ${failures.length} case(s):\n${rendered}`);
  }

  const counts = Array.from(summary.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([outcome, count]) => `${outcome}=${count}`)
    .join(", ");
  console.log(
    `OK: standalone all-samples audit checked ${selectedCases.length}/${cases.length} discovered sample case(s): ${counts}`,
  );
} finally {
  await browser.close();
}

async function runWorker(workerIndex) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let activeErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") activeErrors.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => activeErrors.push(err.message));

  try {
    for (let index = workerIndex; index < selectedCases.length; index += Math.max(1, workers)) {
      const testCase = selectedCases[index];
      activeErrors = [];
      try {
        const outcome = await runCase(page, testCase);
        if (activeErrors.length) {
          failures.push({
            ...testCase,
            reason: `browser errors: ${activeErrors.join(" | ")}`,
            state: outcome.state,
          });
          continue;
        }
        increment(outcome.kind);
      } catch (err) {
        failures.push({
          ...testCase,
          reason: err.message,
          state: err.state,
        });
      }
    }
  } finally {
    await page.close();
  }
}

async function runCase(page, testCase) {
  await page.goto(standalone, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.querySelector("#runtime")?.textContent.includes("formats"),
    null,
    { timeout: 15000 },
  );

  await page.setInputFiles("#fileInput", testCase.files);

  try {
    await page.waitForFunction(
      () => {
        const status = document.querySelector("#status")?.textContent || "";
        return (
          status.includes("loaded") ||
          status.includes("could not decode") ||
          status.includes("no wavelength-indexed spectra") ||
          status.includes("companion") ||
          status.includes("sidecar")
        );
      },
      null,
      { timeout: perCaseTimeoutMs },
    );
  } catch (err) {
    const state = await readState(page);
    const wrapped = new Error(`timed out waiting for handled status: ${err.message}`);
    wrapped.state = state;
    throw wrapped;
  }

  const state = await readState(page);
  const status = state.status || "";
  const lower = `${state.status}\n${state.alerts}\n${state.fileText}\n${state.decisionText}`.toLowerCase();

  if (status.includes("no wavelength-indexed spectra")) {
    if (!lower.includes("non-spectral") && !lower.includes("not nirs") && !lower.includes("excluded from x")) {
      throw withState("non-spectral status without explicit refusal context", state);
    }
    return { kind: "non_spectral_refusal", state };
  }

  if (status.includes("could not decode")) {
    if (!lower.includes("could not be decoded") && !lower.includes("format refused")) {
      throw withState("decode status without an explicit page refusal", state);
    }
    if (strictDecode) {
      throw withState("strict mode treats decode refusals as failures", state);
    }
    return { kind: "decode_refusal", state };
  }

  if (status.includes("loaded")) {
    if (state.validation !== "valid") {
      throw withState(`loaded but DatasetSpec is not valid (${state.validation})`, state);
    }
    if (state.sourceRows < 1) {
      throw withState("loaded but no DatasetSpec source rows were rendered", state);
    }
    if (lower.includes("missing")) {
      throw withState("loaded with a missing-file alert", state);
    }
    if (state.canvasNonWhite < 1000) {
      throw withState("loaded but dataviz canvas appears blank", state);
    }
    return { kind: "loaded", state };
  }

  if (lower.includes("companion") || lower.includes("sidecar")) {
    if (testCase.files.length > 1) {
      throw withState("sidecar alert remained even though companion files were grouped", state);
    }
    return { kind: "sidecar_request", state };
  }

  throw withState("page reached an unclassified state", state);
}

async function readState(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#vizCanvas");
    let canvasNonWhite = 0;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 4) {
        if (!(data[i] > 248 && data[i + 1] > 248 && data[i + 2] > 248)) canvasNonWhite++;
      }
    }
    return {
      status: document.querySelector("#status")?.textContent || "",
      validation: document.querySelector("#validationBadge")?.textContent || "",
      fileText: document.querySelector("#fileList")?.textContent || "",
      alerts: document.querySelector("#datasetAlerts")?.textContent || "",
      decisionText: document.querySelector("#decisionList")?.textContent || "",
      sourceRows: document.querySelectorAll(".source-row").length,
      canvasNonWhite,
    };
  });
}

function withState(message, state) {
  const err = new Error(message);
  err.state = state;
  return err;
}

function increment(kind) {
  summary.set(kind, (summary.get(kind) || 0) + 1);
}

function discoverCases() {
  const files = sampleDirs
    .flatMap((directory) => walk(directory))
    .filter((file) => !shouldIgnore(file))
    .sort((left, right) => left.localeCompare(right));
  const byPath = new Map(files.map((file) => [file, file]));
  const consumedSidecars = new Set();
  const out = [];

  for (const file of files) {
    if (consumedSidecars.has(file)) continue;
    const group = sidecarGroup(file, byPath);
    for (const sidecar of group.slice(1)) consumedSidecars.add(sidecar);
    out.push({
      label: path.relative(formatsRoot, file),
      files: group,
    });
  }

  return out;
}

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(absolute));
    } else if (entry.isFile()) {
      out.push(absolute);
    }
  }
  return out;
}

function shouldIgnore(file) {
  const relative = path.relative(formatsRoot, file).replaceAll(path.sep, "/");
  const base = path.basename(file).toLowerCase();
  const ext = path.extname(file).toLowerCase();
  if (relative.includes("/_archives/")) return true;
  if (base === ".ds_store") return true;
  if (base.includes("readme") || base.startsWith("license") || base === "copying") return true;
  if ([".md", ".pdf", ".yaml", ".yml", ".xsd"].includes(ext)) return true;
  return false;
}

function sidecarGroup(file, byPath) {
  const ext = path.extname(file).toLowerCase();
  const stem = file.slice(0, file.length - path.extname(file).length);
  const sameStem = (sidecarExt) => byPath.get(`${stem}${sidecarExt}`);
  const group = [file];

  if ([".sli", ".img", ".dat"].includes(ext)) {
    const hdr = sameStem(".hdr");
    if (hdr) group.push(hdr);
  } else if (ext === ".lan") {
    const spc = sameStem(".spc");
    if (spc) group.push(spc);
  } else if (ext === ".xml") {
    const h5 = sameStem(".h5");
    if (h5) group.push(h5);
  }

  return group;
}
