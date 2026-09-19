import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveDocumentsDirectory } from "./workspace-location";

describe("default Documents location", () => {
  it("preserves the OS's redirected and localized known folder", () => {
    const documents = path.join(os.tmpdir(), "OneDrive société", "Mes documents");
    const getPath = vi.fn(() => documents);
    expect(resolveDocumentsDirectory(getPath)).toBe(documents);
    expect(getPath).toHaveBeenCalledExactlyOnceWith("documents");
  });

  it("uses the actual OS home when Documents has not been registered", () => {
    const home = path.join(os.tmpdir(), "Profil avec espaces");
    expect(resolveDocumentsDirectory(name => {
      if (name === "documents") throw new Error("Failed to get 'documents' path");
      return home;
    })).toBe(path.join(home, "Documents"));
  });

  it("can resolve a profile without Electron's special-folder service", () => {
    expect(resolveDocumentsDirectory(() => { throw new Error("unavailable"); }))
      .toBe(path.join(os.homedir(), "Documents"));
  });
});
