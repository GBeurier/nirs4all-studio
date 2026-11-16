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

  it("documents installers as Rust plus a user-chosen Python environment", () => {
    const workflow = fs.readFileSync(
      path.join(projectRoot, ".github", "workflows", "release-unified.yml"),
      "utf8",
    );
    expect(workflow).not.toMatch(/Installer: .*venv-based|Installer: .*embedded Python|plugin-only CPython closure/);
    expect(workflow).toContain("Rust sidecar + uv + required wheels");

    const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");
    for (const expected of ["Rust sidecar", "uv", "-offline"]) expect(readme).toContain(expected);
    for (const removed of ["bake-python-plugin-runtime", "setup-python-env", "backend.spec", "PyInstaller", "included CPU runtime"]) {
      expect(readme).not.toContain(removed);
    }
  });

  it("packages the Python runtime pin, the catalogue and the trust helper required by the Electron main process", () => {
    const expectedFiles = ["scripts/python-runtime-config.cjs", "scripts/tls-trust.cjs", "recommended-config.json"];

    expect(configNames).toEqual(["electron-builder.archive.yml", "electron-builder.installer.yml", "electron-builder.offline.yml"]);
    for (const configName of ["electron-builder.archive.yml", "electron-builder.installer.yml"]) {
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

  it("pre-signs the macOS Methods library and excludes only those bytes from builder signing", () => {
    const configPath = path.join(projectRoot, "electron-builder.installer.yml");
    const macSection = getTopLevelYamlSection(configPath, "mac");
    expect(fs.readFileSync(configPath, "utf8")).toMatch(/^afterPack: scripts\/macos-attested-runtime\.cjs$/m);
    expect(macSection.match(/^\s+- '.*'$/gm)).toEqual([
      "    - '[\\\\/]Contents[\\\\/]Resources[\\\\/]backend[\\\\/]native[\\\\/]libn4m\\.dylib$'",
    ]);
    expect(macSection).not.toContain("studio-sidecar");
    expect(macSection).not.toContain("python-runtime/");
  });

  it("ships the sidecar, uv, the required wheels and the adapters, and no Python runtime", () => {
    expect(
      getExtraResourceFilter(
        path.join(projectRoot, "electron-builder.installer.yml"),
        "backend-dist/",
      ),
    ).toEqual(["native/**/*", "tools/**/*", "wheels/**/*", "adapters/**/*"]);
    expect(
      getExtraResourceFilter(
        path.join(projectRoot, "electron-builder.archive.yml"),
        "backend-dist/",
      ),
    ).toEqual(["**/*"]);
  });

  it("derives the offline installer from the standard one, adding only the payload and the artifact suffix", () => {
    const offlinePath = path.join(projectRoot, "electron-builder.offline.yml");
    const offline = fs.readFileSync(offlinePath, "utf8");
    expect(offline).toMatch(/^extends: electron-builder\.installer\.yml$/m);
    expect(getExtraResourceFilter(offlinePath, "backend-dist/")).toEqual(["offline/**/*"]);
    expect(offline.split(/\r?\n/).filter((line) => /^\S/.test(line) && !line.startsWith("#")))
      .toEqual(["extends: electron-builder.installer.yml", "extraResources:", "win:", "mac:", "linux:"]);
    const installer = fs.readFileSync(path.join(projectRoot, "electron-builder.installer.yml"), "utf8");
    for (const platform of ["win", "mac", "linux"]) {
      const standard = new RegExp(`^  artifactName: "(\\$\\{productName\\}-\\$\\{version\\}-${platform}-\\$\\{arch\\})\\.\\$\\{ext\\}"$`, "m").exec(installer);
      expect(standard, platform).not.toBeNull();
      expect(getTopLevelYamlSection(offlinePath, platform).trim()).toBe(`artifactName: "${standard![1]}-offline.\${ext}"`);
    }
    // The user-data preservation include stays in the configuration both installers share.
    expect(getTopLevelYamlSection(path.join(projectRoot, "electron-builder.installer.yml"), "nsis")).toContain("include: build/installer.nsh");
  });

  it("attests install-tree ownership only in standalone archives", () => {
    const marker = fs.readFileSync(
      path.join(projectRoot, "build", "all-in-one-runtime.json"),
      "utf8",
    );
    expect(JSON.parse(marker)).toEqual({
      schema_id: "nirs4all.studio-all-in-one-runtime.v1",
      owns_install_tree: true,
    });
    const archive = fs.readFileSync(
      path.join(projectRoot, "electron-builder.archive.yml"),
      "utf8",
    );
    const installer = fs.readFileSync(
      path.join(projectRoot, "electron-builder.installer.yml"),
      "utf8",
    );
    expect(archive).toContain("from: build/all-in-one-runtime.json");
    expect(archive).toContain("to: all-in-one-runtime.json");
    expect(installer).not.toContain("all-in-one-runtime.json");
  });

  it("publishes every desktop artifact to the canonical Studio repository", () => {
    for (const configName of ["electron-builder.archive.yml", "electron-builder.installer.yml"]) {
      const publishSection = getTopLevelYamlSection(
        path.join(projectRoot, configName),
        "publish",
      );
      expect(publishSection, configName).toContain("provider: github");
      expect(publishSection, configName).toContain("owner: GBeurier");
      expect(publishSection, configName).toContain("repo: nirs4all-studio");
      expect(publishSection, configName).not.toContain("repo: nirs4all-webapp");
    }
  });

  it("never selects Python backend source or a Python runtime for installers", () => {
    const installer = fs.readFileSync(
      path.join(projectRoot, "electron-builder.installer.yml"),
      "utf8",
    );
    expect(installer).not.toMatch(
      /^\s+-\s+"?(?:api|websocket|updater|public)\/|^\s+-\s+"?main\.py/m,
    );
    expect(installer).not.toContain("python-runtime/");
  });
});
