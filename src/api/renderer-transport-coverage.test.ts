import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIRECT_PRODUCT_API_FETCH = /fetch\s*\(\s*["'`]\/api(?:\/|["'`])/;

function typescriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptSources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("renderer transport coverage", () => {
  it("forbids direct product /api fetches outside the preselected transport", () => {
    const bypasses = typescriptSources(SRC_ROOT).filter((path) =>
      DIRECT_PRODUCT_API_FETCH.test(readFileSync(path, "utf8"))
    );

    expect(bypasses).toEqual([]);
  });
});
