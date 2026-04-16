import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function getTopLevelYamlList(filePath: string, key: string): string[] {
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const values: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (!inList) {
      if (line.trim() === `${key}:`) {
        inList = true;
      }
      continue;
    }

    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    if (/^\S/.test(line)) {
      break;
    }

    const match = line.match(/^\s*-\s+(.*)$/);
    if (match) {
      values.push(match[1].trim().replace(/^"(.*)"$/, "$1"));
    }
  }

  return values;
}

function getTopLevelYamlSection(filePath: string, key: string): string {
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const section: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (!inSection) {
      if (line.trim() === `${key}:`) {
        inSection = true;
      }
      continue;
    }

    if (/^\S/.test(line)) {
      break;
    }

    section.push(line);
  }

  return section.join("\n");
}

describe("electron-builder config", () => {
  it("packages the shared Python runtime config required by the Electron main process", () => {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const expectedFiles = ["scripts/python-runtime-config.cjs", "recommended-config.json"];

    for (const configName of ["electron-builder.yml", "electron-builder.installer.yml", "electron-builder.archive.yml"]) {
      const packagedFiles = getTopLevelYamlList(path.join(projectRoot, configName), "files");

      expect(packagedFiles, `${configName} files list`).toEqual(
        expect.arrayContaining(expectedFiles),
      );
    }
  });

  it("leaves mac architecture selection to the CLI so release jobs do not cross-build both arches", () => {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

    for (const configName of ["electron-builder.yml", "electron-builder.installer.yml", "electron-builder.archive.yml"]) {
      const macSection = getTopLevelYamlSection(path.join(projectRoot, configName), "mac");

      expect(macSection, `${configName} mac section`).not.toMatch(/^\s+arch:\s*$/m);
    }
  });
});
