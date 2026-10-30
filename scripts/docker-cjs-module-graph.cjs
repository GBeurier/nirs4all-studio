const fs = require("node:fs");
const path = require("node:path");
const { isBuiltin } = require("node:module");

/** Validate literal CommonJS dependencies against their actual image paths.
 * This deliberately checks the closed local-file COPY graph, not image execution.
 * Cross-stage resources and dynamic non-module assets remain separately verified.
 */
function assertDockerCjsModuleGraph({ projectRoot, dockerfile, stageName, entrypoints }) {
  const files = new Map();
  let stage = null;
  let workdir = "/";
  let stageWorkdir = null;
  const lines = dockerfile.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    const from = /^FROM\s+\S+(?:\s+AS\s+(\S+))?$/i.exec(line);
    if (from) {
      stage = from[1];
      workdir = "/";
      continue;
    }
    if (stage !== stageName) continue;
    const directory = /^WORKDIR\s+(\S+)$/i.exec(line);
    if (directory) {
      workdir = path.posix.resolve(workdir, directory[1]);
      stageWorkdir = workdir;
      continue;
    }
    let copy = /^COPY\s+(.+)$/i.exec(line)?.[1];
    if (!copy || /^--from(?:=|\s)/.test(copy)) continue;
    copy = copy.replace(/^(?:--[\w-]+(?:=\S+)?\s+)+/, "");
    const parts = copy.startsWith("[") ? JSON.parse(copy) : copy.split(/\s+/);
    if (parts.length < 2) throw new Error(`Invalid COPY in ${stageName}: ${line}`);
    const destination = parts.pop();
    for (const source of parts) {
      const sourcePath = path.resolve(projectRoot, source);
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        throw new Error(`Missing local COPY file in ${stageName}: ${source}`);
      }
      const target = path.posix.resolve(workdir, destination);
      const imagePath = destination.endsWith("/") || parts.length > 1
        ? path.posix.join(target, path.posix.basename(source)) : target;
      files.set(imagePath, sourcePath);
    }
  }
  if (!stageWorkdir) throw new Error(`Missing WORKDIR for closed CJS stage ${stageName}`);
  const pending = [...files.keys()].filter((file) => /\.(?:c?js)$/.test(file));
  for (const entrypoint of entrypoints) {
    const imagePath = path.posix.resolve(stageWorkdir, entrypoint);
    if (!files.has(imagePath)) throw new Error(`Missing CJS entrypoint in ${stageName}: ${imagePath}`);
    pending.push(imagePath);
  }
  const visited = new Set();
  let dependencyEdges = 0;
  while (pending.length) {
    const imagePath = pending.pop();
    if (visited.has(imagePath)) continue;
    visited.add(imagePath);
    if (imagePath.endsWith(".json")) continue;
    const code = fs.readFileSync(files.get(imagePath), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const match of code.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      const specifier = match[1];
      if (isBuiltin(specifier)) continue;
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
        throw new Error(`Unstaged external CJS dependency in ${stageName}: ${imagePath} -> ${specifier}`);
      }
      const base = path.posix.resolve(path.posix.dirname(imagePath), specifier);
      const resolved = ["", ".js", ".json", ".node", "/index.js", "/index.json"]
        .map((suffix) => base + suffix).find((candidate) => files.has(candidate));
      if (!resolved) {
        throw new Error(`Missing CJS COPY dependency in ${stageName}: ${imagePath} -> ${specifier}`);
      }
      dependencyEdges += 1;
      pending.push(resolved);
    }
  }
  return { checkedModules: visited.size, dependencyEdges };
}

module.exports = { assertDockerCjsModuleGraph };
