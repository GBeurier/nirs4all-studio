import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const finalizer = require(path.resolve("scripts/finalize-release-assets.cjs")) as {
  canonicalPublishedName(name: string): string;
  expectedPublishedNames(version: string, includeAllInOne?: boolean): string[];
  finalizeReleaseAssets(root: string, expectedNames?: string[] | null): Array<{
    publishedName: string;
    digest: string;
  }>;
};

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nirs4all-release-assets-test-"));
  temporaryRoots.push(root);
  return root;
}

function digest(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writePair(root: string, name: string, bytes = "release-payload"): void {
  fs.writeFileSync(path.join(root, name), bytes);
  fs.writeFileSync(
    path.join(root, `${name}.sha256`),
    `${digest(bytes)}  ${name}\n`,
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("finalize release assets", () => {
  it("publishes canonical GitHub names with directly checkable sidecars", () => {
    const root = temporaryRoot();
    const expectedNames = finalizer.expectedPublishedNames("0.11.2");
    for (const publishedName of expectedNames) {
      writePair(
        root,
        publishedName.replace(/^nirs4all\.Studio-/, "nirs4all Studio-"),
        publishedName,
      );
    }

    const records = finalizer.finalizeReleaseAssets(root, expectedNames);
    expect(records.map((record) => record.publishedName).sort()).toEqual(expectedNames);
    for (const published of expectedNames) {
      expect(fs.existsSync(path.join(root, published.replace(/^nirs4all\.Studio-/, "nirs4all Studio-")))).toBe(false);
      expect(fs.readFileSync(path.join(root, `${published}.sha256`), "ascii")).toBe(
        `${digest(published)}  ${published}\n`,
      );
      expect(
        createHash("sha256")
          .update(fs.readFileSync(path.join(root, published)))
          .digest("hex"),
      ).toBe(digest(published));
    }
  });

  it("refuses a sidecar that names another file", () => {
    const root = temporaryRoot();
    const name = "nirs4all Studio-0.11.2-linux-amd64.deb";
    writePair(root, name);
    fs.writeFileSync(
      path.join(root, `${name}.sha256`),
      `${digest("release-payload")}  other.deb\n`,
    );

    expect(() => finalizer.finalizeReleaseAssets(root)).toThrow(
      "names 'other.deb'",
    );
    expect(fs.existsSync(path.join(root, name))).toBe(true);
  });

  it("refuses a digest mismatch before renaming anything", () => {
    const root = temporaryRoot();
    const name = "nirs4all Studio-0.11.2-win-x64.exe";
    writePair(root, name);
    fs.writeFileSync(
      path.join(root, `${name}.sha256`),
      `${"0".repeat(64)}  ${name}\n`,
    );

    expect(() => finalizer.finalizeReleaseAssets(root)).toThrow(
      "does not match payload",
    );
    expect(fs.existsSync(path.join(root, name))).toBe(true);
  });

  it("refuses canonical-name collisions and unknown files", () => {
    const collisionRoot = temporaryRoot();
    writePair(collisionRoot, "nirs4all Studio-0.11.2-mac-x64.dmg", "one");
    writePair(collisionRoot, "nirs4all.Studio-0.11.2-mac-x64.dmg", "two");
    expect(() => finalizer.finalizeReleaseAssets(collisionRoot)).toThrow(
      "Canonical release asset name collision",
    );

    const unknownRoot = temporaryRoot();
    writePair(unknownRoot, "nirs4all Studio-0.11.2-mac-arm64.dmg");
    fs.writeFileSync(path.join(unknownRoot, "unexpected.txt"), "unexpected");
    expect(() => finalizer.finalizeReleaseAssets(unknownRoot)).toThrow(
      "Unexpected release assets",
    );
  });

  it("refuses an incomplete versioned release inventory", () => {
    const root = temporaryRoot();
    writePair(root, "nirs4all Studio-0.11.2-mac-arm64.dmg");
    expect(() =>
      finalizer.finalizeReleaseAssets(
        root,
        finalizer.expectedPublishedNames("0.11.2"),
      )
    ).toThrow("Release asset inventory mismatch");
  });

  it("supports the installer-only workflow dispatch profile", () => {
    const root = temporaryRoot();
    const expectedNames = finalizer.expectedPublishedNames("0.11.2", false);
    expect(expectedNames).toHaveLength(6);
    expect(expectedNames.every((name) => !name.includes("all-in-one"))).toBe(true);
    for (const publishedName of expectedNames) {
      writePair(
        root,
        publishedName.replace(/^nirs4all\.Studio-/, "nirs4all Studio-"),
        publishedName,
      );
    }
    expect(
      finalizer.finalizeReleaseAssets(root, expectedNames)
        .map((record) => record.publishedName)
        .sort(),
    ).toEqual(expectedNames);
  });

  it("rejects unsafe public names", () => {
    expect(() => finalizer.canonicalPublishedName("../studio.zip")).toThrow(
      "non-canonical public name",
    );
    expect(() => finalizer.canonicalPublishedName("studio\n.zip")).toThrow(
      "non-canonical public name",
    );
  });
});
