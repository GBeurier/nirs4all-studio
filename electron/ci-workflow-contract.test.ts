import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// js-yaml is already installed by the checked-in ESLint toolchain.
const yaml = require("js-yaml") as { load(source: string): Workflow };
interface Step { name?: string; run?: string; if?: string; env?: Record<string, string>; "continue-on-error"?: boolean; with?: Record<string, unknown> }
interface Job { needs?: string | string[]; if?: string; steps?: Step[]; uses?: string; with?: Record<string, unknown>; "continue-on-error"?: boolean }
interface Workflow {
  on: { workflow_call?: { inputs: Record<string, { type: string; required: boolean; default: string }> }; push?: unknown; pull_request?: unknown };
  env?: Record<string, string>;
  jobs: Record<string, Job>;
}
const ci = yaml.load(fs.readFileSync(".github/workflows/ci.yml", "utf8"));
const release = yaml.load(fs.readFileSync(".github/workflows/release-unified.yml", "utf8"));
const directories: string[] = [];
function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-ci-contract-"));
  directories.push(directory);
  return directory;
}
function dependencies(job: Job): string[] { return typeof job.needs === "string" ? [job.needs] : job.needs ?? []; }
function releaseGate(job: string, results: Record<string, string> = {}, flags: Record<string, string> = {}): boolean {
  const expression = release.jobs[job].if!
    .replace(/always\(\)/g, "true")
    .replace(/needs\.prepare\.outputs\.([\w_]+)/g, (_, flag: string) => JSON.stringify(flags[flag] ?? "false"))
    .replace(/needs\.([\w-]+)\.result/g, (_, dependency: string) => {
      expect(dependencies(release.jobs[job])).toContain(dependency);
      return JSON.stringify(results[dependency] ?? "success");
    });
  return runInNewContext(expression, Object.create(null), { timeout: 100 }) as boolean;
}
afterEach(() => { directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })); });

describe("CI release protection graph", () => {
  it("makes the summary depend on every CI job", () => {
    expect(dependencies(ci.jobs.summary).sort()).toEqual(Object.keys(ci.jobs).filter((job) => job !== "summary").sort());
    expect(ci.jobs.summary.if).toBe("always()");
  });

  it("boots the freshly built packaged Linux app before marking Electron CI successful", () => {
    const job = ci.jobs["electron-build"];
    const steps = job.steps!;
    const buildIndex = steps.findIndex((step) => step.run?.includes("electron-builder") && step.run.includes("--dir"));
    const smokeIndex = steps.findIndex((step) => step.run?.includes("scripts/smoke-archive-standalone.cjs"));
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(smokeIndex).toBeGreaterThan(buildIndex);
    expect(steps[smokeIndex].run).toContain("xvfb-run -a node scripts/smoke-archive-standalone.cjs --extracted-root release/linux-unpacked --platform linux");
    expect(steps[smokeIndex].if).toBeUndefined();
    expect(steps[smokeIndex]["continue-on-error"]).not.toBe(true);
    expect(job["continue-on-error"]).not.toBe(true);
  });

  // Execute the actual Ubuntu summary shell program, with GitHub's job results
  // substituted, so a graph dependency without a failure check cannot pass.
  it.skipIf(process.platform === "win32")("rejects every failed, cancelled or skipped prerequisite", () => {
    const summary = ci.jobs.summary.steps!.find((step) => step.run)!.run!;
    const root = temporaryDirectory();
    for (const failedJob of [null, ...dependencies(ci.jobs.summary)]) {
      for (const outcome of failedJob ? ["failure", "cancelled", "skipped"] : ["success"]) {
        const script = summary.replace(/\$\{\{ needs\.([\w-]+)\.result \}\}/g, (_, job: string) => job === failedJob ? outcome : "success");
        const result = spawnSync("bash", ["-e", "-c", script], {
          env: { ...process.env, GITHUB_STEP_SUMMARY: path.join(root, "summary.md") }, encoding: "utf8",
        });
        expect(result.status, `${failedJob ?? "all jobs"}: ${outcome}: ${result.stderr}`).toBe(failedJob ? 1 : 0);
      }
    }
  });

  it("uses the single resolved source commit in every release checkout", () => {
    for (const [name, job] of Object.entries(release.jobs)) {
      if (name === "prepare") continue;
      const checkout = job.uses
        ? job.with?.checkout_ref === "${{ needs.prepare.outputs.checkout_ref }}" || undefined
        : job.steps?.find((step) => step.with?.ref === "${{ needs.prepare.outputs.checkout_ref }}");
      expect(checkout, `${name} must consume the resolved source commit`).toBeDefined();
    }
    const resolution = release.jobs.prepare.steps!.find((step) => step.run?.includes("checkout_ref=$REF"))?.run;
    expect(resolution).toContain("git rev-parse 'HEAD^{commit}'");
    expect(resolution).toContain("git rev-parse 'FETCH_HEAD^{commit}'");
    expect(resolution).toContain('[[ ! "$REF" =~ ^[0-9a-f]{40}$ ]]');
    expect(resolution).not.toContain('REF="$GITHUB_REF"');
    expect(resolution).not.toContain('REF="refs/tags/${TAG}"');
  });

  it.skipIf(process.platform === "win32")("stamps the checked-out product SHA when a manual release uses a different workflow commit", () => {
    const product = "b".repeat(40);
    const workflow = "a".repeat(40);
    const writers = Object.entries(release.jobs).flatMap(([name, job]) =>
      (job.steps ?? []).filter(step => step.name === "Write version.json").map(step => ({ name, step })),
    );
    expect(writers).toHaveLength(4);
    for (const { name, step } of writers) {
      const script = step.run!
        .replaceAll("${{ needs.prepare.outputs.checkout_ref }}", product)
        .replaceAll("${{ github.sha }}", workflow)
        .replaceAll("${{ needs.prepare.outputs.version }}", "0.11.5");
      if (name === "installer-windows") {
        expect(script.match(/commit = "([a-f0-9]+)"/)?.[1], name).toBe(product);
      } else {
        const directory = temporaryDirectory();
        const result = spawnSync("bash", ["-e", "-c", script], { cwd: directory, encoding: "utf8" });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(fs.readFileSync(path.join(directory, "version.json"), "utf8")).commit, name).toBe(product);
      }
    }
  });

  it("accepts immutable reusable CI inputs while retaining normal push and PR defaults", () => {
    const inputs = ci.on.workflow_call!.inputs;
    for (const name of ["checkout_ref", "nirs4all_library_ref", "dag_ml_ref", "dag_ml_data_ref"]) {
      expect(inputs[name]).toMatchObject({ type: "string", required: false, default: "" });
    }
    expect(ci.on.push).toBeDefined();
    expect(ci.on.pull_request).toBeDefined();
    for (const [name, job] of Object.entries(ci.jobs)) {
      if (name === "summary") continue;
      expect(job.steps?.[0].with?.ref, name).toBe("${{ inputs.checkout_ref || github.sha }}");
    }
    for (const [variable, input] of [
      ["NIRS4ALL_LIBRARY_REF", "nirs4all_library_ref"], ["DAG_ML_REF", "dag_ml_ref"], ["DAG_ML_DATA_REF", "dag_ml_data_ref"],
    ]) {
      expect(ci.env?.[variable]).toContain(`inputs.${input} ||`);
      expect(ci.env?.[variable]).toContain("startsWith(github.head_ref || github.ref_name, 'rc/')");
      expect(ci.env?.[variable]).toContain("|| 'main'");
    }
  });

  it("runs reusable quality checks on the exact release commit and pinned library versions", () => {
    const quality = release.jobs.quality;
    expect(quality.uses).toBe("./.github/workflows/ci.yml");
    expect(quality.with?.checkout_ref).toBe("${{ needs.prepare.outputs.checkout_ref }}");
    for (const [input, variable] of [
      ["nirs4all_library_ref", "NIRS4ALL_LIBRARY_REF"], ["dag_ml_ref", "DAG_ML_REF"], ["dag_ml_data_ref", "DAG_ML_DATA_REF"],
    ]) {
      expect(quality.with?.[input]).toMatch(/^[0-9a-f]{40}$/);
      expect(quality.with?.[input]).toBe(release.env?.[variable]);
    }
    for (const publisher of ["docker", "release"]) {
      expect(dependencies(release.jobs[publisher])).toContain("quality");
    }
    for (const [name, job] of Object.entries(release.jobs)) {
      if (name.startsWith("installer-") || name.startsWith("archive-")) {
        expect(dependencies(job), name).toContain("pinned-plugin-wheels");
      }
    }
  });

  it("blocks both publishers when quality or any enabled platform fails or is skipped", () => {
    for (const publisher of ["docker", "release"]) {
      expect(releaseGate(publisher)).toBe(true);
      for (const prerequisite of dependencies(release.jobs[publisher])) {
        for (const outcome of ["failure", "cancelled", "skipped"]) {
          expect(releaseGate(publisher, { [prerequisite]: outcome }), `${publisher}: ${prerequisite} ${outcome}`).toBe(false);
        }
      }
      const skippedArchives = Object.fromEntries(Object.keys(release.jobs).filter((name) => name.startsWith("archive-")).map((name) => [name, "skipped"]));
      expect(releaseGate(publisher, skippedArchives, { skip_all_in_one: "true" })).toBe(false);
      expect(releaseGate(publisher, skippedArchives, { skip_all_in_one: "true", prerelease: "true" })).toBe(true);
      expect(releaseGate(publisher, { ...skippedArchives, quality: "failure" }, { skip_all_in_one: "true" })).toBe(false);
    }
    expect(releaseGate("docker", {}, { skip_docker: "true" })).toBe(false);
    expect(releaseGate("release", { docker: "skipped" }, { skip_docker: "true" })).toBe(true);
  });

  it.skipIf(process.platform === "win32")("promotes the exact tested Docker candidate and reserves latest for stable releases", () => {
    const steps = release.jobs.docker.steps!;
    const publication = steps.find((step) => step.run?.includes("docker push"))!;
    expect(publication.if).toBe("needs.prepare.outputs.is_tag_release == 'true'");
    const root = temporaryDirectory();
    const log = path.join(root, "docker-calls");
    const fakeDocker = path.join(root, "docker");
    fs.writeFileSync(fakeDocker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_TEST_LOG"\n');
    fs.chmodSync(fakeDocker, 0o700);
    for (const prerelease of ["true", "false"]) {
      fs.writeFileSync(log, "");
      const result = spawnSync("bash", ["-e", "-c", publication.run!], {
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, DOCKER_TEST_LOG: log, RELEASE_VERSION: "1.2.3", IS_PRERELEASE: prerelease },
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      const calls = fs.readFileSync(log, "utf8").trim().split("\n");
      const expected = [
        "tag nirs4all-studio:native-release-candidate ghcr.io/gbeurier/nirs4all-studio:1.2.3",
        "push ghcr.io/gbeurier/nirs4all-studio:1.2.3",
      ];
      if (prerelease === "false") expected.push(
        "tag nirs4all-studio:native-release-candidate ghcr.io/gbeurier/nirs4all-studio:latest",
        "push ghcr.io/gbeurier/nirs4all-studio:latest",
      );
      expect(calls).toEqual(expected);
    }
  });
});
