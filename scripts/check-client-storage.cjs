#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "src");

const allowedFiles = new Set([
  path.normalize("src/lib/clientStorage/store.ts"),
]);

const ignoredDirectories = new Set([
  "__tests__",
  "dist",
  "backend-dist",
  "node_modules",
  "playwright-report",
  "storybook-static",
  "test-results",
]);

const ignoredFilePatterns = [
  /\.test\.[cm]?[tj]sx?$/,
  /\.spec\.[cm]?[tj]sx?$/,
];

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const directStoragePattern = /\b(?:window\.)?(?:localStorage|sessionStorage)\s*\./g;

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        walk(path.join(directory, entry.name), files);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(directory, entry.name);
    if (!sourceExtensions.has(path.extname(filePath))) {
      continue;
    }
    if (ignoredFilePatterns.some((pattern) => pattern.test(entry.name))) {
      continue;
    }
    files.push(filePath);
  }
  return files;
}

const violations = [];

for (const filePath of walk(sourceRoot)) {
  const relativePath = path.normalize(path.relative(projectRoot, filePath));
  if (allowedFiles.has(relativePath)) {
    continue;
  }

  const contents = fs.readFileSync(filePath, "utf8");
  const lines = contents.split(/\r?\n/);
  for (const match of contents.matchAll(directStoragePattern)) {
    const beforeMatch = contents.slice(0, match.index);
    const lineNumber = beforeMatch.split(/\r?\n/).length;
    const line = lines[lineNumber - 1]?.trim() ?? "";
    violations.push(`${relativePath}:${lineNumber}: ${line}`);
  }
}

if (violations.length > 0) {
  console.error("Direct browser storage access is not allowed outside clientStorage adapters.");
  console.error("Use src/lib/clientStorage instead of localStorage/sessionStorage in feature code.");
  console.error("");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Client storage guard passed.");
