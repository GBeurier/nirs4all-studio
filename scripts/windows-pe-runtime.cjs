#!/usr/bin/env node
/** Verify that Studio-owned Windows binaries do not depend on the VC++ redist. */

const fs = require("node:fs");
const path = require("node:path");

const MAX_PE_BYTES = 128 * 1024 * 1024;
const MAX_SECTIONS = 96;
const MAX_IMPORTS = 4096;
const MAX_IMPORT_NAME_BYTES = 260;
const FORBIDDEN_RUNTIME_PREFIXES = Object.freeze(["MSVCP", "VCRUNTIME"]);

function checkedRange(buffer, offset, size, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(size) ||
    offset < 0 ||
    size < 0 ||
    offset + size > buffer.length
  ) {
    throw new Error(`Invalid PE ${label} range`);
  }
}

function readUInt16(buffer, offset, label) {
  checkedRange(buffer, offset, 2, label);
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset, label) {
  checkedRange(buffer, offset, 4, label);
  return buffer.readUInt32LE(offset);
}

function parseSections(buffer, sectionTableOffset, count) {
  if (count < 1 || count > MAX_SECTIONS) {
    throw new Error("Invalid PE section count");
  }
  checkedRange(buffer, sectionTableOffset, count * 40, "section table");
  const sections = [];
  for (let index = 0; index < count; index += 1) {
    const offset = sectionTableOffset + index * 40;
    sections.push({
      virtualSize: readUInt32(buffer, offset + 8, "section virtual size"),
      virtualAddress: readUInt32(buffer, offset + 12, "section virtual address"),
      rawSize: readUInt32(buffer, offset + 16, "section raw size"),
      rawOffset: readUInt32(buffer, offset + 20, "section raw offset"),
    });
  }
  return sections;
}

function rvaToOffset(buffer, sections, rva, minimumSize, label) {
  for (const section of sections) {
    const span = Math.max(section.virtualSize, section.rawSize);
    if (rva < section.virtualAddress || rva - section.virtualAddress >= span) continue;
    const delta = rva - section.virtualAddress;
    if (delta + minimumSize > section.rawSize) {
      throw new Error(`Invalid PE ${label} outside raw section bytes`);
    }
    const offset = section.rawOffset + delta;
    checkedRange(buffer, offset, minimumSize, label);
    return offset;
  }
  throw new Error(`Invalid PE ${label} RVA`);
}

function readImportName(buffer, sections, rva) {
  const offset = rvaToOffset(buffer, sections, rva, 1, "import name");
  const limit = Math.min(buffer.length, offset + MAX_IMPORT_NAME_BYTES + 1);
  let end = offset;
  while (end < limit && buffer[end] !== 0) end += 1;
  if (end === offset || end === limit) {
    throw new Error("Invalid PE import name");
  }
  const name = buffer.subarray(offset, end).toString("ascii");
  if (!/^[A-Za-z0-9._+-]+\.dll$/i.test(name)) {
    throw new Error("Invalid PE import name encoding");
  }
  return name.toUpperCase();
}

function parsePeImports(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64 || buffer.length > MAX_PE_BYTES) {
    throw new Error("Windows PE input is empty, truncated, or oversized");
  }
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
    throw new Error("Windows PE input has no DOS signature");
  }
  const peOffset = readUInt32(buffer, 0x3c, "header offset");
  checkedRange(buffer, peOffset, 24, "COFF header");
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error("Windows PE input has no PE signature");
  }
  const sectionCount = readUInt16(buffer, peOffset + 6, "section count");
  const optionalSize = readUInt16(buffer, peOffset + 20, "optional header size");
  const optionalOffset = peOffset + 24;
  checkedRange(buffer, optionalOffset, optionalSize, "optional header");
  const magic = readUInt16(buffer, optionalOffset, "optional header magic");
  const dataDirectoryOffset = optionalOffset + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1);
  if (dataDirectoryOffset < optionalOffset) {
    throw new Error("Unsupported PE optional header magic");
  }
  checkedRange(buffer, dataDirectoryOffset, 16, "data directories");
  const importRva = readUInt32(buffer, dataDirectoryOffset + 8, "import directory RVA");
  const importSize = readUInt32(buffer, dataDirectoryOffset + 12, "import directory size");
  const sections = parseSections(buffer, optionalOffset + optionalSize, sectionCount);
  if (importRva === 0 && importSize === 0) return [];
  if (importRva === 0 || importSize < 20 || importSize > MAX_PE_BYTES) {
    throw new Error("Invalid PE import directory");
  }
  const importsOffset = rvaToOffset(
    buffer,
    sections,
    importRva,
    importSize,
    "import directory",
  );
  const descriptorLimit = importsOffset + importSize;
  checkedRange(buffer, importsOffset, importSize, "import directory");
  const imports = [];
  for (let index = 0; index < MAX_IMPORTS; index += 1) {
    const descriptorOffset = importsOffset + index * 20;
    if (descriptorOffset + 20 > descriptorLimit) {
      throw new Error("PE import directory has no terminating descriptor");
    }
    checkedRange(buffer, descriptorOffset, 20, "import descriptor");
    const fields = [0, 4, 8, 12, 16].map((delta) =>
      readUInt32(buffer, descriptorOffset + delta, "import descriptor"));
    if (fields.every((field) => field === 0)) return [...new Set(imports)].sort();
    if (fields[3] === 0) throw new Error("Invalid PE import descriptor name");
    imports.push(readImportName(buffer, sections, fields[3]));
  }
  throw new Error("Windows PE import inventory exceeds its limit");
}

function assertCanonicalPeFile(filePath) {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size < 1 ||
    metadata.size > MAX_PE_BYTES ||
    fs.realpathSync.native(resolved) !== resolved
  ) {
    throw new Error("Windows PE input must be a bounded canonical regular file");
  }
  return resolved;
}

function assertStaticWindowsRuntime(filePath) {
  const resolved = assertCanonicalPeFile(filePath);
  const imports = parsePeImports(fs.readFileSync(resolved));
  const forbidden = imports.filter((name) =>
    FORBIDDEN_RUNTIME_PREFIXES.some((prefix) => name.startsWith(prefix)));
  if (forbidden.length > 0) {
    throw new Error(
      `Windows binary imports dynamic VC++ runtime libraries: ${forbidden.join(", ")}`,
    );
  }
  return { path: resolved, imports };
}

function main(argv = process.argv.slice(2)) {
  if (argv.length < 1) throw new Error("At least one Windows PE path is required");
  return argv.map((filePath) => assertStaticWindowsRuntime(filePath));
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(main(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  FORBIDDEN_RUNTIME_PREFIXES,
  assertStaticWindowsRuntime,
  main,
  parsePeImports,
};
