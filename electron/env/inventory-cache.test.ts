import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PythonInventory } from "./inventory";
import { readCachedInventory, writeCachedInventory } from "./inventory-cache";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function environment() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-inventory-cache-"));
  roots.push(root);
  const userDataDir = path.join(root, "user-data");
  const purelib = path.join(root, "env", "lib", "site-packages");
  const pythonPath = path.join(root, "env", "bin", "python");
  fs.mkdirSync(purelib, { recursive: true });
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(pythonPath, "");
  fs.writeFileSync(path.join(root, "env", "pyvenv.cfg"), "home = /usr/bin\n");
  const inventory: PythonInventory = {
    pythonVersion: "3.11.13",
    distributions: { nirs4all: "1.4.16" },
    editable: [],
    externallyManaged: false,
    purelib,
    purelibWritable: true,
  };
  return { userDataDir, purelib, pythonPath, inventory };
}

describe("selected environment inventory cache", () => {
  it("returns the stored inventory while the environment is unchanged", () => {
    const { userDataDir, pythonPath, inventory } = environment();
    expect(readCachedInventory(userDataDir, pythonPath)).toBeNull();
    writeCachedInventory(userDataDir, pythonPath, inventory);
    expect(readCachedInventory(userDataDir, pythonPath)).toEqual(inventory);
  });

  it("is invalidated when a distribution is installed, upgraded or removed", () => {
    const { userDataDir, purelib, pythonPath, inventory } = environment();
    writeCachedInventory(userDataDir, pythonPath, inventory);
    // Installers rename `*.dist-info` directories, which updates the package directory.
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(purelib, later, later);
    expect(readCachedInventory(userDataDir, pythonPath)).toBeNull();
  });

  it("does not describe another interpreter", () => {
    const { userDataDir, pythonPath, inventory } = environment();
    writeCachedInventory(userDataDir, pythonPath, inventory);
    expect(readCachedInventory(userDataDir, `${pythonPath}3`)).toBeNull();
  });

  it("ignores an unreadable cache file and tolerates a read-only data directory", () => {
    const { userDataDir, pythonPath, inventory } = environment();
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, "python-inventory.json"), "{");
    expect(readCachedInventory(userDataDir, pythonPath)).toBeNull();
    const blocked = path.join(userDataDir, "file-not-directory");
    fs.writeFileSync(blocked, "");
    expect(() => writeCachedInventory(blocked, pythonPath, inventory)).not.toThrow();
  });
});
