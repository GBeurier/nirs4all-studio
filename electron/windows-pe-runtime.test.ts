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

function peWithImports(names: string[]): Buffer {
  const peOffset = 0x80;
  const optionalOffset = peOffset + 24;
  const optionalSize = 0xf0;
  const sectionOffset = optionalOffset + optionalSize;
  const rawOffset = 0x200;
  const sectionRva = 0x1000;
  const descriptorBytes = (names.length + 1) * 20;
  const buffer = Buffer.alloc(0x1000);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(peOffset, 0x3c);
  buffer.write("PE\0\0", peOffset, "ascii");
  buffer.writeUInt16LE(0x8664, peOffset + 4);
  buffer.writeUInt16LE(1, peOffset + 6);
  buffer.writeUInt16LE(optionalSize, peOffset + 20);
  buffer.writeUInt16LE(0x20b, optionalOffset);
  buffer.writeUInt32LE(sectionRva, optionalOffset + 112 + 8);
  buffer.writeUInt32LE(descriptorBytes, optionalOffset + 112 + 12);
  buffer.write(".rdata\0\0", sectionOffset, "ascii");
  buffer.writeUInt32LE(0xe00, sectionOffset + 8);
  buffer.writeUInt32LE(sectionRva, sectionOffset + 12);
  buffer.writeUInt32LE(0xe00, sectionOffset + 16);
  buffer.writeUInt32LE(rawOffset, sectionOffset + 20);
  let nameOffset = rawOffset + descriptorBytes;
  names.forEach((name, index) => {
    const nameRva = sectionRva + nameOffset - rawOffset;
    buffer.writeUInt32LE(nameRva, rawOffset + index * 20 + 12);
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

  it("fails closed on malformed, symlinked, and oversized PE inputs", () => {
    expect(() => windowsPeRuntime.parsePeImports(Buffer.from("MZ"))).toThrow(/truncated/);
    const unterminated = peWithImports(["KERNEL32.dll"]);
    unterminated.writeUInt32LE(20, 0x80 + 24 + 112 + 12);
    expect(() => windowsPeRuntime.parsePeImports(unterminated)).toThrow(/terminating descriptor/);
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
