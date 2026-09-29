/** Verify that Electron accepts the exact Python plugin shipped in a package. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const asar = require("@electron/asar");
const ts = require("typescript");

const projectRoot = path.join(__dirname, "..");

function loadRuntimeVerifier() {
  const filename = path.join(projectRoot, "electron", "packaged-runtime-contract.ts");
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports.verifyPackagedRuntimeContract;
}

function verifyPackagedPluginIdentity(resourcesPath, options = {}) {
  const resources = path.resolve(resourcesPath);
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const markerPath = path.join(resources, "backend", "python-runtime", "PLUGIN_RUNTIME_READY.json");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const bundle = asar.extractFile(path.join(resources, "app.asar"), "dist-electron/main.cjs").toString("utf8");
  const sidecarPath = path.join(resources, "backend", "native", platform === "win32" ? "studio-sidecar.exe" : "studio-sidecar");
  const sidecar = fs.readFileSync(sidecarPath);
  for (const field of ["source_commit", "wheel_sha256", "distribution_version", "installed_manifest_sha256"]) {
    const value = marker[field];
    assert.equal(typeof value, "string", `Missing plugin marker ${field}`);
    assert.ok(bundle.includes(JSON.stringify(value)), `Packaged Electron does not contain plugin ${field} ${value}`);
    assert.ok(sidecar.includes(Buffer.from(value, "utf8")), `Packaged Rust sidecar does not contain plugin ${field} ${value}`);
  }

  const runtime = loadRuntimeVerifier()({ resourcesPath: resources, platform, arch });
  assert.equal(runtime.pythonPluginHostError, null, "Electron rejects the bundled Python plugin");
  assert.ok(runtime.pythonPluginHostPath, "Packaged Python plugin host is unavailable");
  assert.equal(runtime.methodsLibraryError, null, "Electron rejects the bundled Methods library");
  assert.ok(runtime.methodsLibraryPath, "Packaged Methods library is unavailable");
  return { marker, runtime };
}

if (require.main === module) {
  const resourcesPath = process.argv[2];
  if (!resourcesPath || process.argv.length !== 3) {
    console.error("Usage: node scripts/verify-packaged-plugin-identity.cjs <extracted-resources-path>");
    process.exit(2);
  }
  try {
    const { marker } = verifyPackagedPluginIdentity(resourcesPath);
    console.log(`Packaged Electron accepts nirs4all ${marker.distribution_version} (${marker.wheel_sha256})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { verifyPackagedPluginIdentity };
