import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const windowsPeRuntime = require("../scripts/windows-pe-runtime.cjs") as {
  assertStaticWindowsRuntime(filePath: string): { path: string; imports: string[] };
  parsePeImports(buffer: Buffer): string[];
};

function peWithImports(names: string[], delayedNames: string[] = []): Buffer {
  const peOffset = 0x80;
  const optionalOffset = peOffset + 24;
  const optionalSize = 0xf0;
  const sectionOffset = optionalOffset + optionalSize;
  const rawOffset = 0x200;
  const sectionRva = 0x1000;
  const descriptorBytes = (names.length + 1) * 20;
  const delayedDescriptorOffset = rawOffset + 0x100;
  const delayedDescriptorBytes = (delayedNames.length + 1) * 32;
  const nameStartOffset = rawOffset + 0x200;
  const buffer = Buffer.alloc(0x1000);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(peOffset, 0x3c);
  buffer.write("PE\0\0", peOffset, "ascii");
  buffer.writeUInt16LE(0x8664, peOffset + 4);
  buffer.writeUInt16LE(1, peOffset + 6);
  buffer.writeUInt16LE(optionalSize, peOffset + 20);
  buffer.writeUInt16LE(0x20b, optionalOffset);
  buffer.writeBigUInt64LE(0x1_4000_0000n, optionalOffset + 24);
  buffer.writeUInt32LE(16, optionalOffset + 108);
  buffer.writeUInt32LE(sectionRva, optionalOffset + 112 + 8);
  buffer.writeUInt32LE(descriptorBytes, optionalOffset + 112 + 12);
  if (delayedNames.length > 0) {
    buffer.writeUInt32LE(
      sectionRva + delayedDescriptorOffset - rawOffset,
      optionalOffset + 112 + 13 * 8,
    );
    buffer.writeUInt32LE(
      delayedDescriptorBytes,
      optionalOffset + 112 + 13 * 8 + 4,
    );
  }
  buffer.write(".rdata\0\0", sectionOffset, "ascii");
  buffer.writeUInt32LE(0xe00, sectionOffset + 8);
  buffer.writeUInt32LE(sectionRva, sectionOffset + 12);
  buffer.writeUInt32LE(0xe00, sectionOffset + 16);
  buffer.writeUInt32LE(rawOffset, sectionOffset + 20);
  let nameOffset = nameStartOffset;
  names.forEach((name, index) => {
    const nameRva = sectionRva + nameOffset - rawOffset;
    buffer.writeUInt32LE(nameRva, rawOffset + index * 20 + 12);
    buffer.write(`${name}\0`, nameOffset, "ascii");
    nameOffset += Buffer.byteLength(name, "ascii") + 1;
  });
  delayedNames.forEach((name, index) => {
    const nameRva = sectionRva + nameOffset - rawOffset;
    buffer.writeUInt32LE(1, delayedDescriptorOffset + index * 32);
    buffer.writeUInt32LE(nameRva, delayedDescriptorOffset + index * 32 + 4);
    buffer.write(`${name}\0`, nameOffset, "ascii");
    nameOffset += Buffer.byteLength(name, "ascii") + 1;
  });
  return buffer.subarray(0, nameOffset);
}

describe("Windows static runtime import gate", () => {
  it("accepts OS DLLs and UCRT API sets without VC++ redist imports", () => {
    expect(
      windowsPeRuntime.parsePeImports(
        peWithImports(["KERNEL32.dll", "api-ms-win-crt-runtime-l1-1-0.dll"]),
      ),
    ).toEqual(["API-MS-WIN-CRT-RUNTIME-L1-1-0.DLL", "KERNEL32.DLL"]);
  });

  it.each(["MSVCP140.dll", "VCRUNTIME140.dll", "VCRUNTIME140_1.dll"])(
    "refuses dynamic VC++ runtime import %s",
    (runtime) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-pe-runtime-"));
      try {
        const binary = path.join(root, "studio-owned.exe");
        fs.writeFileSync(binary, peWithImports(["KERNEL32.dll", runtime]));
        expect(() => windowsPeRuntime.assertStaticWindowsRuntime(binary)).toThrow(
          runtime.toUpperCase(),
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("includes delay-load DLLs in the forbidden runtime gate", () => {
    const delayed = peWithImports(["KERNEL32.dll"], ["VCRUNTIME140.dll"]);
    expect(windowsPeRuntime.parsePeImports(delayed)).toEqual([
      "KERNEL32.DLL",
      "VCRUNTIME140.DLL",
    ]);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-pe-delay-runtime-"));
    try {
      const binary = path.join(root, "studio-owned.exe");
      fs.writeFileSync(binary, delayed);
      expect(() => windowsPeRuntime.assertStaticWindowsRuntime(binary)).toThrow(
        "VCRUNTIME140.DLL",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed on unknown delay-load descriptor attributes", () => {
    const delayed = peWithImports([], ["KERNEL32.dll"]);
    delayed.writeUInt32LE(2, 0x200 + 0x100);
    expect(() => windowsPeRuntime.parsePeImports(delayed)).toThrow(
      /delay import attributes/,
    );
  });

  it("fails closed on malformed, symlinked, and oversized PE inputs", () => {
    expect(() => windowsPeRuntime.parsePeImports(Buffer.from("MZ"))).toThrow(/truncated/);
    const unterminated = peWithImports(["KERNEL32.dll"]);
    unterminated.writeUInt32LE(20, 0x80 + 24 + 112 + 12);
    expect(() => windowsPeRuntime.parsePeImports(unterminated)).toThrow(/terminating descriptor/);
    const sectionOverflow = peWithImports(["KERNEL32.dll"]);
    const sectionOffset = 0x80 + 24 + 0xf0;
    sectionOverflow.writeUInt32LE(0x201, sectionOffset + 8);
    sectionOverflow.writeUInt32LE(0x201, sectionOffset + 16);
    expect(() => windowsPeRuntime.parsePeImports(sectionOverflow)).toThrow(/import name/);
    if (process.platform === "win32") return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-pe-link-"));
    try {
      const binary = path.join(root, "binary.exe");
      const link = path.join(root, "link.exe");
      fs.writeFileSync(binary, peWithImports(["KERNEL32.dll"]));
      fs.symlinkSync(binary, link);
      expect(() => windowsPeRuntime.assertStaticWindowsRuntime(link)).toThrow(/canonical/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
