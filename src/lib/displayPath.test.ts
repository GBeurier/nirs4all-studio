import { describe, expect, it } from "vitest";
import { displayPath } from "./displayPath";

describe("displayPath", () => {
  it("removes the Windows extended-length prefix from drive and UNC paths", () => {
    expect(displayPath("\\\\?\\D:\\Mes Donnees\\nirs4all Studio")).toBe("D:\\Mes Donnees\\nirs4all Studio");
    expect(displayPath("\\\\?\\UNC\\server\\share\\data")).toBe("\\\\server\\share\\data");
  });
  it("leaves ordinary and device paths unchanged", () => {
    for (const path of ["D:\\data", "/home/user/data", "\\\\server\\share", "\\\\?\\Volume{1234}\\data"]) {
      expect(displayPath(path)).toBe(path);
    }
  });
});
