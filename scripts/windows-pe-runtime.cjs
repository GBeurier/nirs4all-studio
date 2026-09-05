#!/usr/bin/env node
/** Verify that Studio-owned Windows binaries do not depend on the VC++ redist. */

const fs = require("node:fs");
const path = require("node:path");

const MAX_PE_BYTES = 128 * 1024 * 1024;
const MAX_SECTIONS = 96;
const MAX_IMPORTS = 4096;
const MAX_IMPORT_NAME_BYTES = 260;
const MAX_DATA_DIRECTORIES = 32;
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

function rvaToRawLocation(buffer, sections, rva, minimumSize, label) {
  for (const section of sections) {
    const span = Math.max(section.virtualSize, section.rawSize);
    if (rva < section.virtualAddress || rva - section.virtualAddress >= span) continue;
    const delta = rva - section.virtualAddress;
    if (delta + minimumSize > section.rawSize) {
      throw new Error(`Invalid PE ${label} outside raw section bytes`);
    }
    const offset = section.rawOffset + delta;
    checkedRange(buffer, offset, minimumSize, label);
    return { offset, rawBytesAvailable: section.rawSize - delta };
  }
  throw new Error(`Invalid PE ${label} RVA`);
}

function rvaToOffset(buffer, sections, rva, minimumSize, label) {
  return rvaToRawLocation(buffer, sections, rva, minimumSize, label).offset;
}

function readImportName(buffer, sections, rva) {
  const { offset, rawBytesAvailable } = rvaToRawLocation(
    buffer,
    sections,
    rva,
    1,
    "import name",
  );
  const limit = Math.min(
    buffer.length,
    offset + rawBytesAvailable,
    offset + MAX_IMPORT_NAME_BYTES + 1,
  );
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

function parseImportDirectory({
  buffer,
  sections,
  directoryRva,
  directorySize,
  descriptorSize,
  nameFieldOffset,
  label,
  resolveNameRva = (value) => value,
  validateDescriptor = () => {},
}) {
  if (directoryRva === 0 && directorySize === 0) return [];
  if (
    directoryRva === 0 ||
    directorySize < descriptorSize ||
    directorySize > MAX_PE_BYTES
  ) {
    throw new Error(`Invalid PE ${label}`);
  }
  const directoryOffset = rvaToOffset(
    buffer,
    sections,
    directoryRva,
    directorySize,
    label,
  );
  const descriptorLimit = directoryOffset + directorySize;
  const imports = [];
  for (let index = 0; index < MAX_IMPORTS; index += 1) {
    const descriptorOffset = directoryOffset + index * descriptorSize;
    if (descriptorOffset + descriptorSize > descriptorLimit) {
      throw new Error(`PE ${label} has no terminating descriptor`);
    }
    const fields = [];
    for (let delta = 0; delta < descriptorSize; delta += 4) {
      fields.push(readUInt32(buffer, descriptorOffset + delta, `${label} descriptor`));
    }
    if (fields.every((field) => field === 0)) return imports;
    validateDescriptor(fields);
    const nameValue = fields[nameFieldOffset / 4];
    if (nameValue === 0) throw new Error(`Invalid PE ${label} name`);
    imports.push(readImportName(buffer, sections, resolveNameRva(nameValue, fields)));
  }
  throw new Error(`Windows PE ${label} exceeds its limit`);
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
  const isPe32Plus = magic === 0x20b;
  const isPe32 = magic === 0x10b;
  const dataDirectoryOffset = optionalOffset + (isPe32Plus ? 112 : isPe32 ? 96 : -1);
  if (dataDirectoryOffset < optionalOffset) {
    throw new Error("Unsupported PE optional header magic");
  }
  const directoryCountOffset = optionalOffset + (isPe32Plus ? 108 : 92);
  const directoryCount = readUInt32(buffer, directoryCountOffset, "data directory count");
  if (directoryCount > MAX_DATA_DIRECTORIES) {
    throw new Error("Invalid PE data directory count");
  }
  checkedRange(buffer, dataDirectoryOffset, directoryCount * 8, "data directories");
  if (dataDirectoryOffset + directoryCount * 8 > optionalOffset + optionalSize) {
    throw new Error("Invalid PE data directories outside optional header");
  }
  const sections = parseSections(buffer, optionalOffset + optionalSize, sectionCount);
  const directory = (index, label) => directoryCount > index
    ? {
        rva: readUInt32(buffer, dataDirectoryOffset + index * 8, `${label} RVA`),
        size: readUInt32(buffer, dataDirectoryOffset + index * 8 + 4, `${label} size`),
      }
    : { rva: 0, size: 0 };
  const regular = directory(1, "import directory");
  const delayed = directory(13, "delay import directory");
  const regularImports = parseImportDirectory({
    buffer,
    sections,
    directoryRva: regular.rva,
    directorySize: regular.size,
    descriptorSize: 20,
    nameFieldOffset: 12,
    label: "import directory",
  });
  const imageBase = isPe32Plus
    ? (() => {
        checkedRange(buffer, optionalOffset + 24, 8, "image base");
        return buffer.readBigUInt64LE(optionalOffset + 24);
      })()
    : BigInt(readUInt32(buffer, optionalOffset + 28, "image base"));
  const delayedImports = parseImportDirectory({
    buffer,
    sections,
    directoryRva: delayed.rva,
    directorySize: delayed.size,
    descriptorSize: 32,
    nameFieldOffset: 4,
    label: "delay import directory",
    validateDescriptor: (fields) => {
      if ((fields[0] & ~1) !== 0) {
        throw new Error("Invalid PE delay import attributes");
      }
    },
    resolveNameRva: (value, fields) => {
      if (fields[0] === 1) return value;
      const address = BigInt(value);
      if (address < imageBase || address - imageBase > 0xffff_ffffn) {
        throw new Error("Invalid PE delay import virtual address");
      }
      return Number(address - imageBase);
    },
  });
  return [...new Set([...regularImports, ...delayedImports])].sort();
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
