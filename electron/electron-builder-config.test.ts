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

function getExtraResourceFilter(filePath: string, from: string): string[] {
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const values: string[] = [];
  let inExtraResources = false;
  let inRequestedResource = false;
  let inFilter = false;

  for (const line of lines) {
    if (!inExtraResources) {
      if (line === "extraResources:") inExtraResources = true;
      continue;
    }
    if (/^\S/.test(line)) break;

    const resource = line.match(/^ {2}- from:\s*(.+)$/);
    if (resource) {
      inRequestedResource = resource[1].trim() === from;
      inFilter = false;
      continue;
    }
    if (!inRequestedResource) continue;
    if (line.trim() === "filter:") {
      inFilter = true;
      continue;
    }
    if (!inFilter) continue;

    const value = line.match(/^ {6}-\s+"?(.*?)"?\s*$/);
    if (value) values.push(value[1]);
  }
  return values;
}

describe("electron-builder config", () => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configNames = fs
    .readdirSync(projectRoot)
    .filter((name) => /^electron-builder\..+\.ya?ml$/.test(name))
    .sort();

  it("provides the homepage metadata required by Linux deb packaging", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    );
    expect(packageJson.homepage).toBe("https://nirs4all.org");
  });

  it("documents official installers as Rust plus plugin-only CPython", () => {
    const workflow = fs.readFileSync(
      path.join(projectRoot, ".github", "workflows", "release-unified.yml"),
      "utf8",
    );
    expect(workflow).not.toMatch(/Installer: .*venv-based|Installer: .*embedded Python/);
    expect(workflow).toContain("Rust sidecar + plugin-only CPython closure");

    const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");
    expect(readme).toContain("Rust sidecar");
    expect(readme).toContain("bounded, content-addressed CPython library/plugin host");
    expect(readme).toContain("CPU installer build on the matching host");
    expect(readme).toContain("absent from product installers and all-in-one archives");
    expect(readme).not.toContain("FastAPI files remain packaged transitionally");
  });

  it("packages the shared Python runtime config required by the Electron main process", () => {
    const expectedFiles = ["scripts/python-runtime-config.cjs", "recommended-config.json"];

    expect(configNames).toEqual(["electron-builder.archive.yml", "electron-builder.installer.yml"]);
    for (const configName of configNames) {
      const packagedFiles = getTopLevelYamlList(path.join(projectRoot, configName), "files");

      expect(packagedFiles, `${configName} files list`).toEqual(
        expect.arrayContaining(expectedFiles),
      );
    }
  });

  it("leaves mac architecture selection to the CLI so release jobs do not cross-build both arches", () => {
    for (const configName of configNames) {
      const macSection = getTopLevelYamlSection(path.join(projectRoot, configName), "mac");

      expect(macSection, `${configName} mac section`).not.toMatch(/^\s+arch:\s*$/m);
    }
  });

  it("pre-signs macOS attested runtime bytes and excludes only those bytes from builder signing", () => {
    for (const configName of configNames) {
      const source = fs.readFileSync(path.join(projectRoot, configName), "utf8");
      const macSection = getTopLevelYamlSection(path.join(projectRoot, configName), "mac");
      expect(source, configName).toMatch(
        /^afterPack: scripts\/macos-attested-runtime\.cjs$/m,
      );
      expect(macSection, configName).toContain("signIgnore:");
      expect(macSection, configName).toContain(
        "backend[\\\\/]python-runtime[\\\\/]python[\\\\/]",
      );
      expect(macSection, configName).toContain(
        "backend[\\\\/]native[\\\\/]libn4m\\.dylib$",
      );
      expect(macSection, configName).not.toContain("studio-sidecar");
    }
  });

  it("packages the complete plugin closure and Rust sidecar in every desktop artifact", () => {
    const expectedInstallerFilter = [
      "python-runtime/**/*",
      "native/**/*",
      "recommended-config.json",
      "version.json",
    ];
    expect(
      getExtraResourceFilter(
        path.join(projectRoot, "electron-builder.installer.yml"),
        "backend-dist/",
      ),
    ).toEqual(expectedInstallerFilter);
    expect(
      getExtraResourceFilter(
        path.join(projectRoot, "electron-builder.archive.yml"),
        "backend-dist/",
      ),
    ).toEqual(["**/*"]);
  });

  it("never selects legacy Python backend source for standard installers", () => {
    const installer = fs.readFileSync(
      path.join(projectRoot, "electron-builder.installer.yml"),
      "utf8",
    );
    expect(installer).not.toMatch(
      /^\s+-\s+"?(?:api|websocket|updater|public)\/|^\s+-\s+"?main\.py/m,
    );
    expect(installer).toContain("plugin-only CPython closure");
  });
});
