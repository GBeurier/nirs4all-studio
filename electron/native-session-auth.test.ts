import { describe, expect, it } from "vitest";
import { isStudioDocument } from "./native-session-auth";

describe("native session document identity", () => {
  it("accepts packaged router hashes without trusting unrelated file origins", () => {
    const entry = "file:///opt/Studio%20App/dist/index.html";
    expect(isStudioDocument(`${entry}#/datasets`, entry)).toBe(true);
    expect(isStudioDocument("file:///tmp/untrusted.html", entry)).toBe(false);
    expect(isStudioDocument("https://untrusted.example/", entry)).toBe(false);
  });
  it("binds development routes to the exact configured origin", () => {
    const entry = "http://localhost:5173";
    expect(isStudioDocument(`${entry}/runs`, entry)).toBe(true);
    for (const url of ["http://localhost:5174", "http://localhost.attacker:5173", "http://user@localhost:5173", "null", "invalid"]) {
      expect(isStudioDocument(url, entry)).toBe(false);
    }
  });
});
