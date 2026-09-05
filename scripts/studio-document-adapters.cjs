/** Attest and package pure editor/config translators, never Studio's HTTP backend. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PACKAGE = "studio_document_adapters";
const SCHEMA = "nirs4all.studio-document-adapters.v1";
const SOURCE_FILES = Object.freeze([
  "api/library_documents.py",
  "api/library_dataset_inspection.py",
  "api/library_predictions.py",
  "api/library_runtime_config.py",
  "api/shared/json_safe.py",
  "api/pipeline_canonical.py",
  "api/pipeline_canonical_branch_merge.py",
  "api/pipeline_canonical_generators.py",
  "api/pipeline_canonical_finetune.py",
  "api/node_registry_loader.py",
  "api/shared/dataset_config.py",
]);
const INITIALIZERS = Object.freeze([
  "__init__.py", "api/__init__.py", "api/shared/__init__.py",
]);
const INITIALIZER_BYTES = Buffer.from('"""Pure document translation package; no HTTP or application state."""\n');
const MANIFEST = "sidecar/contracts/studio_document_adapters_v1.json";

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function regularFile(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    if (!part || part === "." || part === "..") throw new Error("Unsafe adapter member path");
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Adapter symlink refused: ${relative}`);
  }
  if (!fs.lstatSync(current).isFile()) throw new Error(`Adapter member is not a file: ${relative}`);
  return fs.readFileSync(current);
}

function registryFiles(root, relative) {
  const result = [];
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) return result;
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("Registry directory symlink refused");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const member = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Registry symlink refused: ${member}`);
    if (entry.isDirectory()) result.push(...registryFiles(root, member));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(member);
  }
  return result;
}

function sourcePayloads(root) {
  const payloads = new Map(INITIALIZERS.map((name) => [name, INITIALIZER_BYTES]));
  const files = [
    ...SOURCE_FILES,
    ...registryFiles(root, "src/data/nodes/definitions"),
    "src/data/nodes/generated/canonical-registry.json",
  ];
  for (const file of files) payloads.set(file, regularFile(root, file));
  return payloads;
}

function buildManifest(root) {
  const payloads = sourcePayloads(root);
  return {
    schema: SCHEMA,
    package: PACKAGE,
    callable: `${PACKAGE}.api.library_documents.adapt_document`,
    ownership: "bounded-library-adapters-no-http-or-scheduler",
    files: [...payloads].sort(([left], [right]) => left.localeCompare(right, "en")).map(([name, bytes]) => ({
      path: name, size: bytes.length, sha256: digest(bytes),
    })),
  };
}

function expectedManifest(root) {
  const expected = JSON.parse(regularFile(root, MANIFEST).toString("utf8"));
  if (JSON.stringify(expected) !== JSON.stringify(buildManifest(root))) {
    throw new Error("Document adapter source attestation is stale; review and regenerate its manifest");
  }
  return expected;
}

function verifyAdapters(root, sitePackages) {
  const expected = expectedManifest(root);
  const packageRoot = path.join(sitePackages, PACKAGE);
  if (fs.lstatSync(packageRoot).isSymbolicLink()) throw new Error("Adapter package symlink refused");
  const actual = [];
  const pending = [""];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(path.join(packageRoot, directory), { withFileTypes: true })) {
      const member = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(member);
      else if (entry.isFile()) actual.push(member);
      else throw new Error(`Adapter special member refused: ${member}`);
    }
  }
  const names = expected.files.map((file) => file.path).sort();
  if (JSON.stringify(actual.sort()) !== JSON.stringify(names)) throw new Error("Adapter package inventory differs");
  for (const file of expected.files) {
    const bytes = regularFile(packageRoot, file.path);
    if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new Error(`Adapter member differs: ${file.path}`);
  }
  return expected;
}

function installAdapters(root, sitePackages) {
  const expected = expectedManifest(root);
  const packageRoot = path.join(sitePackages, PACKAGE);
  if (fs.existsSync(packageRoot)) return verifyAdapters(root, sitePackages);
  const payloads = sourcePayloads(root);
  fs.mkdirSync(packageRoot);
  for (const file of expected.files) {
    const destination = path.join(packageRoot, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, payloads.get(file.path), { flag: "wx" });
  }
  return verifyAdapters(root, sitePackages);
}

if (require.main === module) {
  if (process.argv[2] !== "--manifest") throw new Error("Only explicit --manifest generation is supported");
  const root = path.join(__dirname, "..");
  fs.writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(buildManifest(root), null, 2)}\n`);
}

module.exports = {
  buildManifest,
  installAdapters,
  verifyAdapters,
  PACKAGE,
  SCHEMA,
  SOURCE_FILES,
  MANIFEST,
};
