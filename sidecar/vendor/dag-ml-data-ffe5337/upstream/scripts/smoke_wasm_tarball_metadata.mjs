#!/usr/bin/env node
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import process from "process";

function fail(message) {
  throw new Error(message);
}

function requireCondition(condition, message) {
  if (!condition) {
    fail(message);
  }
}

requireCondition(process.argv[2], "usage: smoke_wasm_tarball_metadata.mjs <wasm-pkg-dir>");
const pkgDir = path.resolve(process.argv[2]);
const packageJsonPath = path.join(pkgDir, "package.json");
requireCondition(fs.existsSync(packageJsonPath), `missing package.json in ${pkgDir}`);

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
requireCondition(
  Array.isArray(packageJson.files) && packageJson.files.length > 0,
  "package.json must declare published files",
);
const packOutput = execFileSync("npm", ["pack", "--dry-run", "--json", pkgDir], {
  encoding: "utf8",
});
const packEntries = JSON.parse(packOutput);
requireCondition(
  Array.isArray(packEntries) && packEntries.length === 1,
  "npm pack dry-run must return exactly one package entry",
);
const pack = packEntries[0];
const fileByPath = new Map(pack.files.map((file) => [file.path, file]));
const requiredFiles = new Set([
  "LICENSE",
  "README.md",
  "package.json",
  ...packageJson.files,
]);

requireCondition(pack.name === packageJson.name, "npm tarball name does not match package.json");
requireCondition(
  pack.version === packageJson.version,
  "npm tarball version does not match package.json",
);
requireCondition(
  pack.filename === `${packageJson.name}-${packageJson.version}.tgz`,
  "npm tarball filename does not match name/version",
);
requireCondition(pack.entryCount === pack.files.length, "npm tarball entryCount is inconsistent");
requireCondition(pack.size > 0, "npm tarball reports empty compressed size");
requireCondition(pack.unpackedSize > 0, "npm tarball reports empty unpacked size");
requireCondition(pack.integrity?.startsWith("sha512-"), "npm tarball missing sha512 integrity");
requireCondition((pack.bundled || []).length === 0, "npm tarball must not bundle dependencies");

for (const requiredFile of requiredFiles) {
  const file = fileByPath.get(requiredFile);
  requireCondition(file, `npm tarball is missing ${requiredFile}`);
  requireCondition(file.size > 0, `npm tarball file ${requiredFile} is empty`);
}
for (const file of pack.files) {
  requireCondition(
    !file.path.includes("pkg-web") && !file.path.includes("target/"),
    `npm tarball contains build-directory path ${file.path}`,
  );
  requireCondition(!file.path.endsWith(".tgz"), `npm tarball contains nested tarball ${file.path}`);
}

console.log(`validated npm tarball metadata for ${packageJson.name} ${packageJson.version}`);
