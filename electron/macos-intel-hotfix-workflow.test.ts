import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = process.cwd();
const workflow = require("js-yaml").load(fs.readFileSync(path.join(root, ".github/workflows/macos-intel-hotfix.yml"), "utf8")) as {
  jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
};
const overlays = ["installer-macos-x64", "archive-macos-x64"].map(name =>
  workflow.jobs[name].steps.find(step => step.name === "Apply only the three content-addressed manufacturing files")!.run!,
);

describe("macOS Intel manufacturing source identity", () => {
  it("uses the same strict overlay guard for installer and archive", () => {
    expect(overlays[0]).toBe(overlays[1]);
  });

  it("accepts untouched CRLF Git blobs but rejects actual content and mode changes", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mac-overlay-"));
    const files = ["build/constraints/plugin-runtime-cpython311.txt", "scripts/bake-python-plugin-runtime.cjs", "scripts/setup-python-env.cjs"];
    const git = (args: string[], input?: string) => execFileSync("git", args, {
      cwd: fixture, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" },
    }).trim();
    try {
      git(["init", "-q"]);
      for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
        fs.writeFileSync(path.join(fixture, file), "original\n");
        fs.mkdirSync(path.dirname(path.join(fixture, "manufacturing", file)), { recursive: true });
        fs.copyFileSync(path.join(root, file), path.join(fixture, "manufacturing", file));
      }
      fs.writeFileSync(path.join(fixture, ".gitattributes"), "*.json text eol=lf\n");
      const model = path.join(fixture, "model.json");
      fs.writeFileSync(model, "{\r\n  \"model\": true\r\n}\r\n");
      git(["add", ".gitattributes", ...files]);
      // Reproduce F314: the raw committed blob contains CRLF despite eol=lf.
      const blob = git(["hash-object", "-w", "--stdin"], fs.readFileSync(model, "utf8"));
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},model.json`]);
      git(["commit", "-qm", "fixture"]);
      const product = git(["rev-parse", "HEAD"]);
      expect(git(["diff", "--name-only"])).toBe("model.json");
      const script = overlays[0].split("node <<'NODE'\n")[1].split("\nNODE")[0];
      const resolve = (file: string) => path.resolve(fixture, file);
      const run = () => vm.runInNewContext(script, {
        Buffer, console: { log() {} },
        process: { platform: "darwin", arch: "x64", env: { PRODUCT_SHA: product, GITHUB_SHA: "manufacturing-fixture", SOURCE_RELEASE_RUN_ID: "35216053291" } },
        require(name: string) {
          if (name === "node:fs") return {
            readFileSync: (file: string) => fs.readFileSync(resolve(file)),
            writeFileSync: (file: string, bytes: string | Buffer) => fs.writeFileSync(resolve(file), bytes),
            lstatSync: (file: string) => fs.lstatSync(resolve(file)),
            readlinkSync: (file: string) => fs.readlinkSync(resolve(file)),
          };
          if (name === "node:child_process") return {
            execFileSync(_command: string, args: string[]) {
              return args[0] === "-C" ? "manufacturing-fixture\n" : git(args);
            },
          };
          return require(name);
        },
      });
      expect(run).not.toThrow();
      fs.appendFileSync(model, "changed\n");
      expect(run).toThrow("Unexpected product source overlay");
      fs.writeFileSync(model, "{\r\n  \"model\": true\r\n}\r\n");
      if (process.platform !== "win32") {
        fs.chmodSync(model, 0o755);
        expect(run).toThrow("Unexpected product source overlay");
      }
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
