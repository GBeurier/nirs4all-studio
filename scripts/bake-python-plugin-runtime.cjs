/** Build and verify Studio's CPython library/plugin runtime (never an HTTP backend). */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const PLUGIN_MARKER_FILE = "PLUGIN_RUNTIME_READY.json";
const PLUGIN_MARKER_SCHEMA = "nirs4all.studio-python-plugin-runtime.v1";
const PLUGIN_ROLE = "library-plugin-host-only";
const PLUGIN_SOURCE_COMMIT = "3a38f589e5acbda58c5d071c95036f2572972ecd";
const PLUGIN_WHEEL_SHA256 = "31a19980014e0538c444c5f9a1a3cff0a8cdd6cf9e9950fe099e016e730865e9";
const PLUGIN_DISTRIBUTION_VERSION = "1.0.0rc2";
const PLUGIN_INSTALLED_MANIFEST_SHA256 = "099259cc3b510fd415b573122630a1db9304fdf847589b2ab92de3b3e8b36ba7";
const PLUGIN_RECORD_SHA256 = "896cb15467a2e7864d5458c42ab37501bfb029c6e8d64fc5c8984999c408930b";
const TOOLS_SOURCE_COMMIT = "e3a332633f87b4652a06f8993e63c386a3568698";
const TOOLS_WHEEL_SHA256 = "372ecec41b18c25c607fd660060f19780cdaf8aea378239fa5ade5a61d81c8dc";
const TOOLS_DISTRIBUTION_VERSION = "0.0.7";
const TOOLS_RECORD_SHA256 = "8db345e39929f63e658d33bba1a9379336547e5653ed4b51271792791e5d6f54";
const TOOLS_INSTALLED_MANIFEST_SHA256 = "37e8862680fe35efcf6b3348ad5c064701f8ba90f43be89bd07c632a59a509fb";
const DUCKDB_VERSION = "1.5.5";
const PYARROW_VERSION = "25.0.1";
const FORBIDDEN_DISTRIBUTIONS = Object.freeze([
  "fastapi",
  "httptools",
  "python-multipart",
  "sentry-sdk",
  "starlette",
  "uvicorn",
  "uvloop",
  "watchfiles",
  "websockets",
]);
const FORBIDDEN_TOP_LEVEL_MODULES = Object.freeze([
  "fastapi",
  "httptools",
  "multipart",
  "sentry_sdk",
  "starlette",
  "uvicorn",
  "uvloop",
  "watchfiles",
  "websockets",
]);

const PREFLIGHT = String.raw`import base64,csv,hashlib,importlib.metadata,io,json,os,socket,subprocess,sys
def deny(event,args):
    if event == "socket.bind": raise RuntimeError("listener denied")
    if event in {"subprocess.Popen","os.system","os.spawn","os.posix_spawn","os.fork","os.forkpty","os.exec","pty.spawn"}: raise RuntimeError("spawn denied")
sys.addaudithook(deny)
sys.path.insert(0,sys.argv[1])
bind_denied=spawn_denied=spawnv_denied=False
s=socket.socket()
try: s.bind(("127.0.0.1",0))
except RuntimeError: bind_denied=True
finally: s.close()
try: subprocess.Popen([sys.executable,"-c","pass"])
except RuntimeError: spawn_denied=True
if os.name == "posix":
    try: os.spawnv(os.P_WAIT,"/bin/true",["true"])
    except RuntimeError: spawnv_denied=True
else: spawnv_denied=True
import nirs4all,nirs4all_tools,duckdb,pyarrow,pyarrow.parquet as parquet
d=importlib.metadata.distribution("nirs4all")
r=next(x for x in d.files or [] if str(x).endswith(".dist-info/RECORD")); record_bytes=open(d.locate_file(r),"rb").read()
rows=sorted(set(tuple(row) for row in csv.reader(io.StringIO(record_bytes.decode("utf-8"))) if row[1] and not row[0].endswith(".pyc") and not row[0].startswith("../../../") and row[0].rsplit("/",1)[-1] not in {"INSTALLER","REQUESTED","direct_url.json"}))
m="".join(",".join(row)+"\n" for row in rows).encode("utf-8")
verified=True
for relative,encoded,size in rows:
    algorithm,expected=encoded.split("=",1); payload=open(d.locate_file(relative),"rb").read(); actual=base64.urlsafe_b64encode(hashlib.new(algorithm,payload).digest()).decode("ascii").rstrip("=")
    if actual != expected or (size and len(payload) != int(size)): verified=False; break
td=importlib.metadata.distribution("nirs4all-tools")
tr=next(x for x in td.files or [] if str(x).endswith(".dist-info/RECORD")); trb=open(td.locate_file(tr),"rb").read()
trows=sorted(set(tuple(row) for row in csv.reader(io.StringIO(trb.decode("utf-8"))) if row[1] and not row[0].endswith(".pyc") and not row[0].startswith("../../../") and row[0].rsplit("/",1)[-1] not in {"INSTALLER","REQUESTED","direct_url.json"}))
tm="".join(",".join(row)+"\n" for row in trows).encode("utf-8")
tverified=True
for relative,encoded,size in trows:
    algorithm,expected=encoded.split("=",1); payload=open(td.locate_file(relative),"rb").read(); actual=base64.urlsafe_b64encode(hashlib.new(algorithm,payload).digest()).decode("ascii").rstrip("=")
    if actual != expected or (size and len(payload) != int(size)): tverified=False; break
dc=duckdb.connect(":memory:"); duckdb_functional=dc.execute("SELECT 40 + 2").fetchone()==(42,); dc.close()
table=pyarrow.table({"value":[1,2,3]}); sink=pyarrow.BufferOutputStream(); parquet.write_table(table,sink); payload=sink.getvalue(); restored=parquet.read_table(pyarrow.BufferReader(payload)); pyarrow_functional=restored.equals(table)
print(json.dumps({"bind_denied":bind_denied,"spawn_denied":spawn_denied,"spawnv_denied":spawnv_denied,"implementation":sys.implementation.name,"isolated":bool(sys.flags.isolated),"no_site":bool(sys.flags.no_site),"dont_write_bytecode":bool(sys.dont_write_bytecode),"version":d.version,"record":hashlib.sha256(record_bytes).hexdigest(),"manifest":hashlib.sha256(m).hexdigest(),"verified":verified,"callable":callable(getattr(nirs4all,"studio_scientific_job_v1",None)),"tools_version":td.version,"tools_record":hashlib.sha256(trb).hexdigest(),"tools_manifest":hashlib.sha256(tm).hexdigest(),"tools_verified":tverified,"tools_module":getattr(nirs4all_tools,"__name__",None),"duckdb_version":duckdb.__version__,"pyarrow_version":pyarrow.__version__,"duckdb_functional":duckdb_functional,"pyarrow_parquet_functional":pyarrow_functional},sort_keys=True,separators=(",",":")))`;

function normalizeDistribution(name) {
  return name.trim().toLowerCase().replace(/[_.]+/g, "-");
}

function findSitePackages(runtimeRoot) {
  const candidates = [];
  const windows = path.join(runtimeRoot, "Lib", "site-packages");
  if (fs.existsSync(windows)) candidates.push(windows);
  const lib = path.join(runtimeRoot, "lib");
  if (fs.existsSync(lib)) {
    for (const entry of fs.readdirSync(lib)) {
      if (/^python3\.\d+$/.test(entry)) {
        const candidate = path.join(lib, entry, "site-packages");
        if (fs.existsSync(candidate)) candidates.push(candidate);
      }
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`Plugin runtime requires exactly one site-packages; found ${candidates.length}`);
  }
  return candidates[0];
}

function bundledPython(runtimeRoot, platform = process.platform) {
  return platform === "win32"
    ? path.join(runtimeRoot, "python.exe")
    : path.join(runtimeRoot, "bin", "python3");
}

function removeBytecode(runtimeRoot) {
  const pending = [runtimeRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name === "__pycache__") {
        fs.rmSync(entryPath, { recursive: true, force: true });
      } else if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".pyc")) {
        fs.rmSync(entryPath, { force: true });
      }
    }
  }
}

function removeEmptyDirectories(runtimeRoot) {
  const directories = [];
  const pending = [runtimeRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    directories.push(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        pending.push(path.join(directory, entry.name));
      }
    }
  }
  directories.sort((left, right) => right.length - left.length);
  for (const directory of directories) {
    if (directory !== runtimeRoot && fs.readdirSync(directory).length === 0) {
      fs.rmdirSync(directory);
    }
  }
}

function assertClosedTree(runtimeRoot) {
  const pending = [runtimeRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const metadata = fs.lstatSync(entryPath);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new Error(`Plugin runtime contains a link or special file: ${entryPath}`);
      }
      if (metadata.isDirectory()) pending.push(entryPath);
      if (metadata.isFile() && (entry.name.endsWith(".pth") || entry.name.endsWith(".pyc"))) {
        throw new Error(`Plugin runtime contains a forbidden acquisition artifact: ${entryPath}`);
      }
    }
  }
}

function materializeInternalRuntimeLinks(runtimeRoot) {
  const canonicalRoot = fs.realpathSync(runtimeRoot);
  const rootPrefix = `${canonicalRoot}${path.sep}`;

  for (let pass = 0; pass < 10; pass += 1) {
    const links = [];
    const pending = [runtimeRoot];
    while (pending.length > 0) {
      const directory = pending.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        const metadata = fs.lstatSync(entryPath);
        if (metadata.isSymbolicLink()) links.push(entryPath);
        else if (metadata.isDirectory()) pending.push(entryPath);
      }
    }
    if (links.length === 0) return;

    for (const linkPath of links) {
      const resolvedTarget = fs.realpathSync(linkPath);
      if (resolvedTarget !== canonicalRoot && !resolvedTarget.startsWith(rootPrefix)) {
        throw new Error(`Plugin runtime link escapes its package root: ${linkPath}`);
      }
      const targetMetadata = fs.statSync(resolvedTarget);
      fs.unlinkSync(linkPath);
      if (targetMetadata.isFile()) {
        fs.copyFileSync(resolvedTarget, linkPath);
        fs.chmodSync(linkPath, targetMetadata.mode & 0o777);
      } else if (targetMetadata.isDirectory()) {
        fs.cpSync(resolvedTarget, linkPath, {
          recursive: true,
          dereference: true,
          preserveTimestamps: true,
        });
      } else {
        throw new Error(`Plugin runtime link targets a special file: ${linkPath}`);
      }
    }
  }
  throw new Error("Plugin runtime link materialization did not converge");
}

function installedDistributions(sitePackages) {
  const names = [];
  for (const entry of fs.readdirSync(sitePackages)) {
    if (!entry.endsWith(".dist-info")) continue;
    const metadataPath = path.join(sitePackages, entry, "METADATA");
    const metadata = fs.readFileSync(metadataPath, "utf8");
    const match = /^Name:\s*(.+)$/im.exec(metadata);
    if (!match) throw new Error(`Distribution metadata has no Name: ${metadataPath}`);
    names.push(normalizeDistribution(match[1]));
  }
  return names.sort();
}

function assertPluginOnlyPayload(backendRoot, runtimeRoot, sitePackages) {
  for (const relative of ["api", "websocket", "main.py"]) {
    if (fs.existsSync(path.join(backendRoot, relative))) {
      throw new Error(`Python backend source is forbidden in Phase 2 payload: ${relative}`);
    }
  }
  const installed = new Set(installedDistributions(sitePackages));
  const denied = FORBIDDEN_DISTRIBUTIONS.filter((name) => installed.has(name));
  for (const moduleName of FORBIDDEN_TOP_LEVEL_MODULES) {
    for (const suffix of ["", ".py"]) {
      if (fs.existsSync(path.join(sitePackages, `${moduleName}${suffix}`))) denied.push(moduleName);
    }
  }
  if (denied.length > 0) {
    throw new Error(`Plugin runtime contains forbidden Python backend packages: ${[...new Set(denied)].sort().join(", ")}`);
  }
  assertClosedTree(runtimeRoot);
  return [...installed];
}

function runPreflight(runtimeRoot, sitePackages, platform = process.platform) {
  const python = bundledPython(runtimeRoot, platform);
  if (!fs.existsSync(python) || fs.lstatSync(python).isSymbolicLink()) {
    throw new Error(`Plugin runtime interpreter is absent or linked: ${python}`);
  }
  const result = spawnSync(python, ["-I", "-S", "-B", "-c", PREFLIGHT, sitePackages], {
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Plugin runtime preflight failed: ${(result.stderr || "").trim()}`);
  }
  const response = JSON.parse(result.stdout);
  if (
    response.bind_denied !== true ||
    response.spawn_denied !== true ||
    response.spawnv_denied !== true ||
    response.implementation !== "cpython" ||
    response.isolated !== true ||
    response.no_site !== true ||
    response.dont_write_bytecode !== true ||
    response.version !== PLUGIN_DISTRIBUTION_VERSION ||
    response.record !== PLUGIN_RECORD_SHA256 ||
    response.manifest !== PLUGIN_INSTALLED_MANIFEST_SHA256 ||
    response.verified !== true ||
    response.callable !== true
    || response.tools_version !== TOOLS_DISTRIBUTION_VERSION
    || response.tools_record !== TOOLS_RECORD_SHA256
    || response.tools_manifest !== TOOLS_INSTALLED_MANIFEST_SHA256
    || response.tools_verified !== true
    || response.tools_module !== "nirs4all_tools"
    || response.duckdb_version !== DUCKDB_VERSION
    || response.pyarrow_version !== PYARROW_VERSION
    || response.duckdb_functional !== true
    || response.pyarrow_parquet_functional !== true
  ) {
    throw new Error(`Plugin runtime preflight identity mismatch: ${result.stdout.trim()}`);
  }
  return response;
}

function markerPath(backendRoot) {
  return path.join(backendRoot, "python-runtime", PLUGIN_MARKER_FILE);
}

function expectedMarker(platform = process.platform, arch = process.arch) {
  return {
    schema: PLUGIN_MARKER_SCHEMA,
    python_role: PLUGIN_ROLE,
    product_backend: "rust-sidecar",
    transport: "bounded-cpython-stdio-v1",
    http_listener: "forbidden",
    source_commit: PLUGIN_SOURCE_COMMIT,
    wheel_sha256: PLUGIN_WHEEL_SHA256,
    distribution: "nirs4all",
    distribution_version: PLUGIN_DISTRIBUTION_VERSION,
    installed_manifest_sha256: PLUGIN_INSTALLED_MANIFEST_SHA256,
    distribution_record_sha256: PLUGIN_RECORD_SHA256,
    platform,
    arch,
    forbidden_distributions: [...FORBIDDEN_DISTRIBUTIONS],
    conversion_tools: {
      source_commit: TOOLS_SOURCE_COMMIT,
      wheel_sha256: TOOLS_WHEEL_SHA256,
      distribution: "nirs4all-tools",
      distribution_version: TOOLS_DISTRIBUTION_VERSION,
      distribution_record_sha256: TOOLS_RECORD_SHA256,
      installed_manifest_sha256: TOOLS_INSTALLED_MANIFEST_SHA256,
      module: "nirs4all_tools",
      cli: "python -I -B -m nirs4all_tools",
      readers: { duckdb: DUCKDB_VERSION, pyarrow: PYARROW_VERSION },
      functional_probes: {
        duckdb: "in-memory-select-40-plus-2",
        pyarrow_parquet: "in-memory-round-trip",
      },
    },
  };
}

function verifyPluginRuntime({ backendRoot, platform = process.platform, arch = process.arch, writeMarker = false }) {
  const runtimeRoot = path.join(backendRoot, "python-runtime", "python");
  const sitePackages = findSitePackages(runtimeRoot);
  if (writeMarker) {
    removeBytecode(runtimeRoot);
    // electron-builder does not preserve empty directories. Normalize them
    // before content-addressing so the packaged closure remains identical.
    removeEmptyDirectories(runtimeRoot);
  }
  const distributions = assertPluginOnlyPayload(backendRoot, runtimeRoot, sitePackages);
  const preflight = runPreflight(runtimeRoot, sitePackages, platform);
  const expected = expectedMarker(platform, arch);
  const readyPath = markerPath(backendRoot);
  if (writeMarker) {
    fs.rmSync(path.join(backendRoot, "python-runtime", "RUNTIME_READY.json"), { force: true });
    fs.writeFileSync(readyPath, `${JSON.stringify(expected, null, 2)}\n`);
  } else {
    const actual = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Plugin runtime marker identity mismatch");
    }
  }
  return { runtimeRoot, sitePackages, readyPath, distributions, preflight };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    backendRoot: path.join(projectRoot, "backend-dist"),
    cacheDir: path.join(projectRoot, "build", ".python-cache"),
    constraints: "",
    pluginWheel: "",
    toolsWheel: "",
    verifyOnly: false,
    finalizeExisting: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--backend-root") options.backendRoot = path.resolve(argv[++index]);
    else if (arg === "--cache-dir") options.cacheDir = path.resolve(argv[++index]);
    else if (arg === "--constraints") options.constraints = path.resolve(argv[++index]);
    else if (arg === "--plugin-wheel") options.pluginWheel = path.resolve(argv[++index]);
    else if (arg === "--tools-wheel") options.toolsWheel = path.resolve(argv[++index]);
    else if (arg === "--verify-only") options.verifyOnly = true;
    else if (arg === "--finalize-existing") options.finalizeExisting = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function runSetup(options) {
  fs.rmSync(options.backendRoot, { recursive: true, force: true });
  const args = [
    path.join(__dirname, "setup-python-env.cjs"),
    "--profile", "cpu-lite",
    "--output-dir", path.join(options.backendRoot, "python-runtime"),
    "--cache-dir", options.cacheDir,
    "--runtime-only",
    "--build-mode", "studio-python-plugin-runtime",
    "--clean",
  ];
  if (options.constraints) args.push("--constraints", options.constraints);
  if (options.pluginWheel) args.push("--plugin-wheel", options.pluginWheel);
  if (options.toolsWheel) args.push("--tools-wheel", options.toolsWheel);
  const result = spawnSync(process.execPath, args, { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error(`Plugin runtime setup failed with code ${result.status}`);
}

function main() {
  const options = parseArgs();
  if (!options.verifyOnly && !options.finalizeExisting) {
    runSetup(options);
    materializeInternalRuntimeLinks(path.join(options.backendRoot, "python-runtime", "python"));
  }
  const verified = verifyPluginRuntime({
    backendRoot: options.backendRoot,
    writeMarker: !options.verifyOnly,
  });
  console.log(`Plugin-only CPython runtime verified: ${verified.runtimeRoot}`);
  console.log(`Installed distributions: ${verified.distributions.length}`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`Plugin runtime bake failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  assertPluginOnlyPayload,
  FORBIDDEN_DISTRIBUTIONS,
  PLUGIN_MARKER_FILE,
  PLUGIN_MARKER_SCHEMA,
  PLUGIN_ROLE,
  PLUGIN_SOURCE_COMMIT,
  PLUGIN_WHEEL_SHA256,
  expectedMarker,
  findSitePackages,
  materializeInternalRuntimeLinks,
  removeEmptyDirectories,
  parseArgs,
  verifyPluginRuntime,
};
