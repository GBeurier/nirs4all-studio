import { pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");
const workspace = path.resolve(root, "..", "..");
const formatsRoot = process.env.N4IO_FORMATS_ROOT || path.join(workspace, "nirs4all-formats");
const formatsSamples = path.join(formatsRoot, "samples");
const standalone = pathToFileURL(path.join(root, "dist", "nirs4all-io-standalone.html")).href;
const chromeExecutable = process.env.CHROME_BIN || "/usr/bin/google-chrome";

async function loadPlaywright() {
  const moduleName = process.env.PLAYWRIGHT_MODULE || "playwright";
  const specifier = moduleName.startsWith("/") ? pathToFileURL(moduleName).href : moduleName;
  return import(specifier);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
  args: ["--allow-file-access-from-files"],
});

const errors = [];
function hook(page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
}

async function newStandalonePage(viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  hook(page);
  await page.goto(standalone, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.querySelector("#runtime")?.textContent.includes("formats"),
    null,
    { timeout: 10000 },
  );
  return page;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await sampleDatasetFlow();
  await dragAndDropFlow();
  await mixedRepeatedTableFlow();
  await zstdParquetFlow();
  await sidecarFlow();
  await folderUploadFlow();
  await nonSpectralRefusalFlow();
  await formatRefusalFlow();

  if (errors.length) {
    throw new Error(`browser errors:\n${errors.join("\n")}`);
  }
  console.log("OK: standalone file:// smoke passed");
} finally {
  await browser.close();
}

async function sampleDatasetFlow() {
  const page = await newStandalonePage({ width: 1440, height: 1100 });
  await page.click("#loadSample");
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("loaded"),
    null,
    { timeout: 15000 },
  );
  const result = await page.evaluate(() => {
    const canvas = document.querySelector("#vizCanvas");
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (!(data[i] > 248 && data[i + 1] > 248 && data[i + 2] > 248)) nonWhite++;
    }
    return {
      status: document.querySelector("#status")?.textContent,
      validation: document.querySelector("#validationBadge")?.textContent,
      readers: document.querySelectorAll(".reader-tags span").length,
      sourceRows: document.querySelectorAll(".source-row").length,
      target: document.querySelector("#targetSelect")?.value,
      activeTab: document.querySelector(".tab.active")?.textContent,
      legend: document.querySelector("#legend")?.textContent,
      canvasNonWhite: nonWhite,
    };
  });
  assert(result.status.includes("train/test"), "sample flow did not infer train/test");
  assert(result.validation === "valid", "sample DatasetSpec is not valid");
  assert(result.readers >= 40, "reader coverage is not visible");
  assert(result.sourceRows >= 6, "sample sources not rendered");
  assert(result.target === "protein", "sample target not selected");
  assert(result.activeTab === "Y histogram", "Y histogram not active");
  assert(result.legend.includes("protein"), "Y histogram legend missing target");
  assert(result.canvasNonWhite > 1000, "dataviz canvas appears blank");
  await page.close();
}

async function dragAndDropFlow() {
  const page = await newStandalonePage({ width: 1100, height: 820 });
  await page.evaluate(async () => {
    const file = new File([
      "sample_id;1000;1010\ns1;0.1;0.2\ns2;0.2;0.3\n",
    ], "dragged.csv", { type: "text/csv" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        types: [],
        items: [],
        files: [file],
        dropEffect: "none",
      },
      configurable: true,
    });
    document.querySelector("#drop").dispatchEvent(event);
  });
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("loaded"),
    null,
    { timeout: 15000 },
  );
  const result = await page.evaluate(() => ({
    status: document.querySelector("#status")?.textContent,
    fileText: document.querySelector("#fileList")?.textContent,
    validation: document.querySelector("#validationBadge")?.textContent,
  }));
  assert(result.status.includes("single table"), "drop flow did not infer a single table");
  assert(result.fileText.includes("dragged.csv"), "drop flow did not add the dropped file");
  assert(result.validation === "valid", "drop flow DatasetSpec is not valid");
  await page.close();
}

async function mixedRepeatedTableFlow() {
  const page = await newStandalonePage({ width: 1280, height: 980 });
  const text = [
    "sample_id;replicate;protein;1000;1010;1020;batch",
    "s1;r1;10;0.1;0.2;0.3;A",
    "s1;r2;10;0.2;0.3;0.4;A",
    "s2;r1;12;0.3;0.4;0.5;B",
    "s2;r2;12;0.4;0.5;0.6;B",
    "s3;r1;13;0.5;0.6;0.7;C",
    "",
  ].join("\n");
  await page.setInputFiles("#fileInput", [
    {
      name: "mixed.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(text),
    },
  ]);
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("loaded"),
    null,
    { timeout: 15000 },
  );
  const result = await page.evaluate(() => {
    const canvas = document.querySelector("#vizCanvas");
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (!(data[i] > 248 && data[i + 1] > 248 && data[i + 2] > 248)) nonWhite++;
    }
    const spec = JSON.parse(document.querySelector('[name="json"]')?.value || "{}");
    const source = spec.sources?.[0] || {};
    const byRole = Object.fromEntries((source.columns || []).map((entry) => [entry.role, entry.select || []]));
    return {
      validation: document.querySelector("#validationBadge")?.textContent,
      target: document.querySelector("#targetSelect")?.value,
      activeTab: document.querySelector(".tab.active")?.textContent,
      legend: document.querySelector("#legend")?.textContent,
      canvasNonWhite: nonWhite,
      sampleKey: document.querySelector('[name="sample_index_key"]')?.value,
      observationId: document.querySelector('[name="sample_observation_id"]')?.value,
      repetitionId: document.querySelector('[name="sample_repetition_id"]')?.value,
      repetition: document.querySelector('[name="repetition"]')?.value,
      selectedInference: document.querySelector("#decisionList")?.textContent,
      spec,
      byRole,
    };
  });
  assert(result.validation === "valid", "mixed repeated table DatasetSpec is not valid");
  assert(result.sampleKey === "sample_id", "mixed table sample key not inferred");
  assert(result.observationId === "sample_id", "mixed table observation id not inferred");
  assert(result.repetitionId === "replicate", "mixed table repetition id not inferred");
  assert(result.repetition === "replicate", "mixed table top-level repetition not inferred");
  assert(result.target === "protein", "mixed table target not selected");
  assert(result.activeTab === "Y histogram", "mixed table did not show Y histogram");
  assert(result.legend.includes("protein"), "mixed table Y histogram legend missing protein");
  assert(result.canvasNonWhite > 1000, "mixed table dataviz canvas appears blank");
  assert(
    ["1000", "1010", "1020"].every((col) => result.byRole.features?.includes(col)),
    `mixed table features were not inferred from spectral columns: ${JSON.stringify(result.byRole.features)}`,
  );
  assert(result.byRole.targets?.includes("protein"), "mixed table target column protein not inferred as Y");
  assert(!result.byRole.features?.includes("protein"), "mixed table target protein was inferred as X");
  assert(result.byRole.metadata?.includes("batch"), "mixed table batch not inferred as metadata");
  assert(result.byRole.metadata?.includes("replicate"), "mixed table replicate not inferred as metadata");
  assert(result.selectedInference.includes("single table"), "mixed table structure evidence missing");
  await page.close();
}

async function zstdParquetFlow() {
  const page = await newStandalonePage({ width: 1280, height: 920 });
  await page.setInputFiles("#fileInput", path.join(formatsSamples, "parquet/synthetic_nirs.parquet"));
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("loaded"),
    null,
    { timeout: 15000 },
  );
  const result = await page.evaluate(() => {
    const canvas = document.querySelector("#vizCanvas");
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (!(data[i] > 248 && data[i + 1] > 248 && data[i + 2] > 248)) nonWhite++;
    }
    return {
      status: document.querySelector("#status")?.textContent,
      validation: document.querySelector("#validationBadge")?.textContent,
      fileText: document.querySelector("#fileList")?.textContent,
      target: document.querySelector("#targetSelect")?.value,
      canvasNonWhite: nonWhite,
      alerts: document.querySelector("#datasetAlerts")?.textContent || "",
    };
  });
  assert(result.status.includes("loaded"), "zstd Parquet status did not load");
  assert(result.validation === "valid", "zstd Parquet DatasetSpec is not valid");
  assert(result.fileText.includes("parquet-nirs-table"), "zstd Parquet format not shown");
  assert(result.target === "protein", "zstd Parquet target not selected");
  assert(!result.alerts.includes("could not be decoded"), "zstd Parquet still refused");
  assert(result.canvasNonWhite > 1000, "zstd Parquet dataviz canvas appears blank");
  await page.close();
}

async function sidecarFlow() {
  const page = await newStandalonePage({ width: 1000, height: 760 });
  await page.setInputFiles("#fileInput", [
    {
      name: "scene.lan",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("HEAD74 synthetic ERDAS LAN header"),
    },
  ]);
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("companion"),
    null,
    { timeout: 10000 },
  );
  const missing = await page.evaluate(() => document.querySelector("#datasetAlerts")?.textContent || "");
  assert(missing.includes("scene.spc"), "ERDAS LAN sidecar alert missing scene.spc");

  await page.setInputFiles("#fileInput", [
    {
      name: "scene.spc",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("wavelengths"),
    },
  ]);
  await page.waitForFunction(
    () => !document.querySelector("#datasetAlerts")?.textContent.includes("scene.spc"),
    null,
    { timeout: 10000 },
  );
  await page.close();
}

async function folderUploadFlow() {
  const page = await newStandalonePage({ width: 1100, height: 820 });
  await page.evaluate(async () => {
    const files = [
      ["nirs/train/X_train.csv", "id;400;410\na;1;2\nb;2;3\nc;3;4\n"],
      ["nirs/train/y_train.csv", "id;protein\na;10\nb;11\nc;12\n"],
      ["nirs/train/metadata_train.csv", "id;batch\na;A\nb;A\nc;B\n"],
      ["nirs/test/X_test.csv", "id;400;410\nd;4;5\ne;5;6\n"],
      ["nirs/test/y_test.csv", "id;protein\nd;13\ne;14\n"],
      ["nirs/test/metadata_test.csv", "id;batch\nd;B\ne;C\n"],
    ].map(([relativePath, text]) => {
      const file = new File([text], relativePath.split("/").pop(), { type: "text/csv" });
      Object.defineProperty(file, "webkitRelativePath", { value: relativePath, configurable: true });
      return file;
    });
    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    const input = document.querySelector("#folderInput");
    Object.defineProperty(input, "files", { value: dt.files, configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("loaded"),
    null,
    { timeout: 15000 },
  );
  const result = await page.evaluate(() => ({
    status: document.querySelector("#status")?.textContent,
    firstFile: document.querySelector(".file-name")?.textContent,
    target: document.querySelector("#targetSelect")?.value,
    map: document.querySelector("#datasetMap")?.textContent,
  }));
  assert(result.status.includes("train/test"), "folder flow did not infer train/test");
  assert(result.firstFile.includes("nirs/train/X_train.csv"), "relative path not preserved");
  assert(result.target === "protein", "folder flow target not detected");
  assert(result.map.includes("joins train_x"), "folder flow joins not shown");
  await page.close();
}

async function nonSpectralRefusalFlow() {
  const page = await newStandalonePage({ width: 1000, height: 760 });
  const text = "SCAN ID,YEAR,DATE,DOY,DegDay,TIME,SITE,EXPERIMENT,BLOCK,TREATMENT,REP,NDVI (MODIS),EVI (MODIS),EVI2 (MODIS),PRI (550 Reference),PRI (570 Ref),WBI,Chl Index,LAI\n1,2007,2007-06-01,152,0,12:00,A,E,B,T,1,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8\n";
  await page.setInputFiles("#fileInput", [
    {
      name: "arc_lter_unispec_dc_2007_2019_indices.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(text),
    },
  ]);
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("no wavelength-indexed spectra"),
    null,
    { timeout: 10000 },
  );
  const result = await page.evaluate(() => ({
    alert: document.querySelector("#datasetAlerts")?.textContent,
    probe: document.querySelector(".file-probe")?.textContent,
    specText: document.querySelector("#specForm")?.textContent,
    decision: document.querySelector("#decisionList")?.textContent,
  }));
  assert(result.alert.includes("excluded from X inference"), "non-spectral alert missing");
  assert(result.probe.includes("not wavelength-i"), "format refusal message missing");
  assert(!result.probe.includes("does not support in-memory reads"), "generic in-memory fallback leaked");
  assert(result.specText.includes("Dataset properties appear after inference"), "non-spectral file created a spec");
  assert(result.decision.includes("non-spectral"), "non-spectral decision missing");
  await page.close();
}

async function formatRefusalFlow() {
  const mzmlPage = await newStandalonePage({ width: 1000, height: 760 });
  await mzmlPage.setInputFiles("#fileInput", path.join(formatsSamples, "mzml/example.mzML"));
  await mzmlPage.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("no wavelength-indexed spectra"),
    null,
    { timeout: 10000 },
  );
  const mzml = await mzmlPage.evaluate(() => ({
    alert: document.querySelector("#datasetAlerts")?.textContent,
    probe: document.querySelector(".file-probe")?.textContent,
    specText: document.querySelector("#specForm")?.textContent,
    decision: document.querySelector("#decisionList")?.textContent,
  }));
  assert(mzml.alert.includes("excluded from X inference"), "mzML non-spectral alert missing");
  assert(mzml.probe.includes("mass-spectrometry data, not NIRS spectroscopy"), "mzML refusal message missing");
  assert(mzml.specText.includes("Dataset properties appear after inference"), "mzML created a spec");
  assert(mzml.decision.includes("non-spectral"), "mzML non-spectral decision missing");
  await mzmlPage.close();
}
