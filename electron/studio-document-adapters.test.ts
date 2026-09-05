import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const adapters = require("../scripts/studio-document-adapters.cjs") as {
  buildManifest(root: string): { files: { path: string }[] };
  installAdapters(root: string, site: string): unknown;
  verifyAdapters(root: string, site: string): unknown;
};
const root = path.resolve(import.meta.dirname, "..");
const temporary: string[] = [];
function installed() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-adapters-"));
  temporary.push(directory);
  adapters.installAdapters(root, directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("pure document adapter closure", () => {
  it("packages only explicit pure modules and registry JSON, with inert initializers", () => {
    const directory = installed();
    expect(adapters.verifyAdapters(root, directory)).toEqual(adapters.buildManifest(root));
    const members = adapters.buildManifest(root).files.map((entry) => entry.path);
    expect(members).toContain("api/library_documents.py");
    expect(members.some((name) => /(^|\/)(jobs|datasets|pipelines|app_config)\.py$/.test(name))).toBe(false);
    expect(fs.readFileSync(path.join(directory, "studio_document_adapters/api/__init__.py"), "utf8")).not.toContain("import");
  });
  it("refuses changed, extra and symlink members rather than replacing an existing closure", () => {
    const directory = installed();
    const packageRoot = path.join(directory, "studio_document_adapters");
    const member = path.join(packageRoot, "api/library_documents.py");
    const original = fs.readFileSync(member);
    fs.appendFileSync(member, "\n# changed\n");
    expect(() => adapters.verifyAdapters(root, directory)).toThrow("member differs");
    expect(() => adapters.installAdapters(root, directory)).toThrow("member differs");
    fs.writeFileSync(member, original);
    const extra = path.join(packageRoot, "api/extra.py");
    fs.writeFileSync(extra, "pass\n");
    expect(() => adapters.verifyAdapters(root, directory)).toThrow("inventory differs");
    fs.unlinkSync(extra);
    fs.symlinkSync(member, extra);
    expect(() => adapters.verifyAdapters(root, directory)).toThrow("special member refused");
  });
});
