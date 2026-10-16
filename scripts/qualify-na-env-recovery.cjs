/** Exercise the packaged product with generated NA fixtures and a reusable Python. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const smoke = require("./smoke-first-launch-ui.cjs");
const archive = require("./smoke-archive-standalone.cjs");

async function main() {
  const args = process.argv.slice(2);
  const take = flag => {
    const index = args.indexOf(flag);
    assert(index >= 0 && args[index + 1], `Required: ${flag}`);
    return path.resolve(args[index + 1]);
  };
  const extractedRoot = take("--extracted-root");
  const fixturesRoot = take("--fixtures-root");
  const python = take("--python");
  const sandbox = take("--sandbox-root");
  const normalize = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  const expectedCases = JSON.parse(fs.readFileSync(path.join(fixturesRoot, "expected.json"), "utf8"));
  const record = execFileSync(python, ["-I", "-B", "-c",
    "import importlib.metadata; print(importlib.metadata.distribution('nirs4all')._path / 'RECORD')"],
  { encoding: "utf8", windowsHide: true }).trim();
  const hashRecord = () => crypto.createHash("sha256").update(fs.readFileSync(record)).digest("hex");
  const originalRecord = hashRecord();
  const linked = [];
  const reports = [];
  // Seed a private workspace before Electron's first-launch default
  // workspace initializer runs. Windows Known Folders ignore USERPROFILE.
  const configRoot = path.join(sandbox, "native-config");
  fs.mkdirSync(configRoot, { recursive: true });
  const reserved = path.join(sandbox, "reserved-workspace");
  fs.mkdirSync(reserved, { recursive: true });
  const workspaceFile = path.join(reserved, "workspace.json");
  if (!fs.existsSync(workspaceFile)) fs.writeFileSync(workspaceFile, JSON.stringify({
    path: reserved, name: "QA reservation", description: null, created_at: new Date().toISOString(),
    last_accessed: new Date().toISOString(), datasets: [], pipelines: [], groups: [],
  }));
  const settings = path.join(configRoot, "app_settings.json");
  if (!fs.existsSync(settings)) fs.writeFileSync(settings, JSON.stringify({ linked_workspaces: [
    { id: "qa-private", path: reserved, name: "QA reservation", is_active: true, linked_at: new Date().toISOString(), discovered: {} },
  ] }));
  const config = archive.assertValidConfig({ extractedRoot, platform: process.platform,
    appName: "nirs4all Studio", port: 0, timeoutMs: 120000, sandboxRoot: sandbox, keepSandbox: true });

  const request = async (env, endpoint, body) => {
    const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_NATIVE_SIDECAR_PORT}/api${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Nirs4all-Session": env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000),
    });
    const data = await response.json();
    assert(response.ok, `${endpoint}: HTTP ${response.status}: ${JSON.stringify(data)}`);
    return data;
  };
  const checkPreview = (name, preview) => {
    assert.equal(preview.success, true, `${name}: ${preview.error}`);
    assert.equal(preview.summary.num_samples, 48, name);
    assert.equal(preview.summary.train_samples, 36, name);
    assert.equal(preview.summary.test_samples, 12, name);
    if (name !== "clean") assert.equal(preview.target_distribution.missing_count, 5, name);
    if (name === "sparse-classes") assert.equal(preview.target_distribution.classes.length, 2, name);
  };
  const checkSelection = async page => {
    const info = await page.evaluate(() => window.electronApi.getEnvInfo());
    assert.equal(normalize(info.pythonPath), normalize(python));
    assert.equal(info.status, "ready");
    assert.equal(await page.evaluate(() => window.electronApi.shouldShowWizard()), false,
      "A verified environment must not restart onboarding after a Studio version change");
    assert.equal(hashRecord(), originalRecord, "Selecting/restarting must not reinstall the SDK");
  };
  for (let cycle = 0; cycle < 3; cycle++) {
    await smoke.main({ config, sandboxRoot: sandbox, existingProfile: cycle > 0,
      userDataDir: path.join(sandbox, "electron-user-data"),
      envOverrides: { NIRS4ALL_CONFIG: configRoot },
      inspectProfile: async ({ page, env }) => {
        if (cycle > 0) return checkSelection(page);
        const inspection = await page.evaluate(p => window.electronApi.inspectExistingPython(p), python);
        assert.equal(inspection.success, true, inspection.message);
        assert.equal(inspection.info.hasCorePackages, true, JSON.stringify(inspection.info.corePackageIssues));
        const selected = await page.evaluate(p => window.electronApi.applyExistingPython(p, { installCorePackages: false }), python);
        assert.equal(selected.success, true, selected.message);
        await checkSelection(page);
        const workspace = path.join(sandbox, "workspace");
        await request(env, "/workspace/create", { path: workspace, name: "NA recovery qualification", create_dir: true });
        await request(env, "/workspace/select", { path: workspace, persist_global: true });
        for (const entry of fs.readdirSync(fixturesRoot, { withFileTypes: true }).filter(item => item.isDirectory())) {
          const name = entry.name;
          const root = path.join(fixturesRoot, name);
          const files = fs.readdirSync(root).filter(file => file.endsWith(".csv")).map(file => ({
            path: path.join(root, file), type: { X: "X", Y: "Y", M: "metadata" }[file[0]],
            split: file.includes("cal") ? "train" : "test", enabled: true,
          }));
          const parsing = { delimiter: ";", decimal_separator: name === "decimal-comma" ? "," : ".",
            has_header: name !== "headerless", na_policy: name === "missing-spectra" ? "ignore" : "auto" };
          const shapes = await request(env, "/datasets/validate-files", { path: root, files, parsing, per_file_overrides: {} });
          for (const file of files) {
            assert.equal(shapes.shapes[file.path].num_rows, file.split === "train" ? 36 : 12, `${name}/${file.path}`);
            assert(!shapes.shapes[file.path].error, JSON.stringify(shapes.shapes[file.path]));
            const expected = expectedCases[`${name}/${file.split === "train" ? "cal" : "val"}`];
            const role = file.type === "metadata" ? "M" : file.type;
            assert.equal(shapes.shapes[file.path].missing_count, expected[`missing${role}`], `${name}/${file.path}: NA cells`);
          }
          if (name === "missing-spectra" || name === "sparse-targets") {
            const strict = await request(env, "/datasets/validate-files", { path: root, files,
              parsing: { ...parsing, na_policy: name === "missing-spectra" ? "auto" : "abort" }, per_file_overrides: {} });
            const role = name === "missing-spectra" ? "X" : "Y";
            assert(strict.shapes[files.find(file => file.type === role && file.split === "train").path].error,
              `${name}: explicit strict loading must refuse the missing values`);
          }
          const preview = await request(env, "/datasets/preview", { path: root, files, parsing, max_samples: 48 });
          checkPreview(name, preview);
          const saved = await request(env, "/datasets/link", { path: root,
            config: { files, global_params: parsing, task_type: name === "sparse-classes" ? "binary_classification" : "regression" } });
          assert.equal(saved.success, true, JSON.stringify(saved));
          linked.push({ name, id: saved.dataset.id });
          reports.push({ case: name, samples: preview.summary.num_samples, missing: preview.target_distribution.missing_count });
        }
      },
      journeys: async ({ page, env }) => {
        await checkSelection(page);
        for (const dataset of linked) checkPreview(dataset.name,
          await request(env, `/datasets/${encodeURIComponent(dataset.id)}/preview`));
        console.log(`Recovery cycle ${cycle + 1}: same Python, unchanged SDK, ${linked.length} reopened datasets`);
      },
    });
    if (cycle === 0) {
      const settingsFile = path.join(sandbox, "electron-user-data", "env-settings.json");
      const selection = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      selection.appVersion = "0.15.3";
      selection.skipWizardOnLaunch = false;
      fs.writeFileSync(settingsFile, JSON.stringify(selection, null, 2));
    }
  }
  fs.writeFileSync(path.join(sandbox, "qualification.json"), JSON.stringify({ cycles: 3, launches: 6, datasets: reports }, null, 2));
  console.log("Packaged NA and environment recovery qualification passed.");
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
