// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Playwright product runtime contract", () => {
  it("starts the Rust sidecar and never a Python HTTP backend", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "playwright.config.ts"), "utf8");

    expect(source).toContain("cargo run --manifest-path sidecar/Cargo.toml --locked");
    expect(source).toContain("node_modules/vite/bin/vite.js");
    expect(source).not.toContain("command: `npm run dev");
    expect(source).not.toContain("run-python.cjs main.py");
    expect(source).not.toContain("FastAPI backend");
    expect(source).not.toContain("FastAPI serving static files");

    const setup = fs.readFileSync(path.join(process.cwd(), "e2e/fixtures/global-setup.ts"), "utf8");
    expect(setup).toContain("/api/app/settings");
    expect(setup).not.toContain("/api/workspace/settings");
  });
});
