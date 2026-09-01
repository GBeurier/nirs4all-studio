import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");
const workspace = path.resolve(root, "..", "..");
const formatsSamples = path.join(workspace, "nirs4all-formats", "samples");
const standalone = pathToFileURL(path.join(root, "dist", "nirs4all-io-standalone.html")).href;
const chromeExecutable = process.env.CHROME_BIN || "/usr/bin/google-chrome";

async function loadPlaywright() {
  const moduleName = process.env.PLAYWRIGHT_MODULE || "playwright";
  const specifier = moduleName.startsWith("/") ? pathToFileURL(moduleName).href : moduleName;
  return import(specifier);
}

const cases = [
  ["csv_like", ["csv_tsv/synthetic_nirs.csv"], "delimited-text"],
  ["jcamp", ["jcamp_dx/TESTSPEC.DX"], "jcamp-dx"],
  ["asd", ["asd/soil.asd"], "asd-fieldspec"],
  ["bruker_dpt", ["bruker_dpt/synthetic.dpt"], "bruker-dpt"],
  ["bruker_opus", ["bruker_opus/test_spectra.0"], "bruker-opus"],
  ["nicolet_omnic", ["nicolet_omnic/2-BaSO4_0.SPA"], "nicolet-omnic-spa"],
  ["perkin_elmer", ["perkin_elmer/spectra.sp"], "perkin-elmer-sp"],
  ["buchi_nircal", ["buchi_nircal/muestras-tejido-foliar_transfer.nir"], "buchi-nircal"],
  ["jasco_jws", ["jasco/243.jws"], "jasco-jws"],
  ["horiba_labspec_xml", ["raman_horiba/jobinyvon_test_spec.xml"], "horiba-jobinyvon-xml"],
  ["horiba_labspec_txt", ["raman_horiba/labspec_532nm_Si.txt"], "horiba-labspec-text"],
  ["renishaw_wdf", ["raman_renishaw/renishaw_test_spectrum.wdf"], "renishaw-wdf"],
  ["trivista_tvf", ["raman_trivista/spec_1s_1acc_1frame_average.tvf"], "trivista-tvf"],
  ["digitalsurf", ["digitalsurf/test_spectrum.pro"], "digitalsurf-sur-pro"],
  ["hamamatsu_img", ["hamamatsu/focus_mode.img"], "hamamatsu-img"],
  ["galactic_spc", ["galactic_spc/nir.spc"], "galactic-spc"],
  ["foss_winisi", ["foss_winisi/synthetic.cal"], "foss-winisi-cal"],
  ["viavi_micronir", ["viavi_micronir/synthetic_micronir.sam"], "viavi-micronir-sam"],
  ["scio_csv", ["scio/scio_app_scan.csv"], "scio-csv"],
  ["avantes_ascii", ["avantes/avantes_export.ttt"], "avantes-ascii"],
  ["avantes_binary", ["avantes/avantes2.TRM"], "avantes-legacy-binary"],
  ["ocean_optics", ["ocean_optics/OOusb4000.txt"], "ocean-optics-text"],
  ["numpy_npy", ["numpy/synthetic_nirs_X.npy"], "numpy-npy"],
  ["numpy_npz", ["numpy/synthetic_nirs.npz"], "numpy-npz"],
  ["parquet_zstd", ["parquet/synthetic_nirs.parquet"], "parquet-nirs-table"],
  ["parquet_uncompressed", ["parquet/synthetic_nirs_uncompressed.parquet"], "parquet-nirs-table"],
  ["sed", ["spectral_evolution/serbinsh_cvars_grape_leaf.sed"], "spectral-evolution-sed"],
  ["svc_sig", ["svc_ger/BNL13001_000_moc.sig"], "svc-ger-sig"],
  ["siware_api_json", ["siware_api/synthetic_siware_api.json"], "siware-api-json"],
  ["siware_api_csv", ["siware_api/synthetic_siware_api.csv"], "row-spectral-table"],
  ["netcdf", ["netcdf/synthetic_nirs.nc"], "netcdf-nirs"],
  ["hdf5", ["hdf5/synthetic_nirs.h5"], "hdf5-nirs"],
  ["matlab_v5", ["matlab/synthetic_nirs_v5.mat"], "matlab-mat-v5"],
  ["matlab_v73", ["matlab/synthetic_nirs_v73.mat"], "matlab-mat-v73"],
  ["rdata", ["matlab/prospectr_NIRsoil.RData"], "rdata-prospectr-nirsoil"],
  ["excel", ["excel/synthetic_nirs.xlsx"], "excel-xlsx"],
  ["pp_systems_spt", ["pp_systems/synthetic_unispec.SPT"], "pp-systems-unispec"],
  ["pp_systems_spu", ["pp_systems/synthetic_unispec_dc.SPU"], "pp-systems-unispec"],
  ["usgs_aref", ["envi_sli/usgs_liba_AREF.txt"], "usgs-aref-single-column"],
  ["spectral_matrix", ["metrohm/synthetic_visionair.csv"], "spectral-matrix"],
  ["sun_photometer", ["mfr/synthetic_mfr.OUT"], "mfr-sun-photometer"],
  ["animl", ["animl/synthetic_nirs.animl"], "animl"],
  ["allotrope_asm", ["allotrope_asm/MD_SMP_absorbance_example.json"], "allotrope-asm-json"],
  ["msa", ["msa_iso22029/example1.msa"], "emsa-mas-msa"],
  ["witec_wip", ["raman_witec/Sa4.wip"], "witec-wip"],
  ["envi_sli", ["envi_sli/synthetic_lib.sli", "envi_sli/synthetic_lib.hdr"], "envi-sli"],
  ["envi_standard_cube", ["envi_sli/cubescope-mini-cube.img", "envi_sli/cubescope-mini-cube.hdr"], "envi-standard-cube"],
  ["erdas_lan", ["hyperspectral_cubes/92AV3C.lan", "hyperspectral_cubes/92AV3C.spc"], "erdas-lan-aviris"],
  ["fgi_xml", ["fgi/synthetic_fgi.xml", "fgi/synthetic_fgi.h5"], "fgi-hdf5-xml"],
].map(([label, files, expectedText]) => ({ label, files, expectedText }));

const localAdf = path.join(workspace, "nirs4all-formats", "samples_local", "allotrope_adf", "adfsee_example.adf");
if (fs.existsSync(localAdf)) {
  cases.push({
    label: "allotrope_adf_local",
    absoluteFiles: [localAdf],
    expectedText: "allotrope-adf",
  });
}

const localPerkinElmerCsv = path.join(workspace, "nirs4all-formats", "samples_local", "perkin_elmer", "426475_1.csv");
if (fs.existsSync(localPerkinElmerCsv)) {
  cases.push({
    label: "perkin_elmer_csv_local",
    absoluteFiles: [localPerkinElmerCsv],
    expectedText: "perkin-elmer-csv",
  });
}

for (const testCase of cases) {
  for (const relative of testCase.files || []) {
    const absolute = path.join(formatsSamples, relative);
    if (!fs.existsSync(absolute)) {
      throw new Error(`${testCase.label}: missing fixture ${absolute}`);
    }
  }
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
    if (msg.type() === "error") errors.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(err.message));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  for (const testCase of cases) {
    await runCase(testCase);
  }
  if (errors.length) throw new Error(`browser errors:\n${errors.join("\n")}`);
  console.log(`OK: standalone real-format smoke opened ${cases.length} dataset fixture(s)`);
} finally {
  await browser.close();
}

async function runCase(testCase) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  hook(page);
  await page.goto(standalone, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.querySelector("#runtime")?.textContent.includes("formats"),
    null,
    { timeout: 10000 },
  );
  await page.setInputFiles(
    "#fileInput",
    testCase.absoluteFiles || testCase.files.map((relative) => path.join(formatsSamples, relative)),
  );
  try {
    await page.waitForFunction(
      ({ expectedText, expectedRows }) => {
        const fileText = document.querySelector("#fileList")?.textContent || "";
        const status = document.querySelector("#status")?.textContent || "";
        return fileText.includes(expectedText) && status.includes("loaded");
      },
      { expectedText: testCase.expectedText },
      { timeout: 30000 },
    );
  } catch (err) {
    const state = await page.evaluate(() => ({
      status: document.querySelector("#status")?.textContent,
      fileText: document.querySelector("#fileList")?.textContent,
      validation: document.querySelector("#validationBadge")?.textContent,
      alerts: document.querySelector("#datasetAlerts")?.textContent,
    }));
    throw new Error(`${testCase.label}: decode wait failed: ${err.message}\n${JSON.stringify(state, null, 2)}`);
  }
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
      decisionText: document.querySelector("#decisionList")?.textContent,
      sourceRows: document.querySelectorAll(".source-row").length,
      canvasNonWhite: nonWhite,
      alerts: document.querySelector("#datasetAlerts")?.textContent || "",
    };
  });
  assert(result.status.includes("loaded"), `${testCase.label}: status did not load`);
  assert(result.fileText.includes(testCase.expectedText), `${testCase.label}: expected format text missing`);
  assert(result.validation === "valid", `${testCase.label}: inferred spec is not valid`);
  assert(result.sourceRows >= 1, `${testCase.label}: no DatasetSpec source rendered`);
  assert(result.decisionText.includes("Reader coverage"), `${testCase.label}: reader coverage missing`);
  assert(!result.alerts.includes("missing"), `${testCase.label}: unexpected missing alert`);
  assert(result.canvasNonWhite > 1000, `${testCase.label}: dataviz canvas appears blank`);
  await page.close();
}
