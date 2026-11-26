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
interface Step { name?: string; run?: string; uses?: string; if?: string; env?: Record<string, string>; "continue-on-error"?: boolean; with?: Record<string, unknown> }
interface Job {
  needs?: string | string[]; if?: string; steps?: Step[]; uses?: string; with?: Record<string, unknown>; "continue-on-error"?: boolean;
  strategy?: { matrix?: string | { include?: Array<Record<string, string>> } };
}
interface Workflow {
  on: { workflow_call?: { inputs: Record<string, { type: string; required: boolean; default: string | boolean }> }; push?: unknown; pull_request?: unknown };
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
    .replace(/cancelled\(\)/g, "false")
    .replace(/needs\.prepare\.outputs\.([\w_]+)/g, (_, flag: string) => JSON.stringify(flags[flag] ?? ({ is_tag_release: "true", delivery_channel: "all" } as Record<string, string>)[flag] ?? "false"))
    .replace(/needs\.([\w-]+)\.result/g, (_, dependency: string) => {
      expect(dependencies(release.jobs[job])).toContain(dependency);
      return JSON.stringify(results[dependency] ?? "success");
    });
  return runInNewContext(expression, { startsWith: (value: string, prefix: string) => value.startsWith(prefix) }, { timeout: 100 }) as boolean;
}
afterEach(() => { directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })); });

describe("CI release protection graph", () => {
  it("checks out the exact Methods source required by the product runtime contract", () => {
    const contract = require("../scripts/native-runtime-contract.cjs") as {
      METHODS_SOURCE_COMMIT: string;
      METHODS_ABI_MAJOR: number;
      METHODS_ABI_MINOR: number;
    };
    const action = yaml.load(fs.readFileSync(
      path.resolve(import.meta.dirname, "../.github/actions/build-native-methods/action.yml"),
      "utf8",
    )) as unknown as {
      description: string;
      runs: { steps: Array<{ with?: { repository?: string; ref?: string } }> };
    };
    const checkouts = action.runs.steps.filter(
      step => step.with?.repository === "GBeurier/nirs4all-methods",
    );
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].with?.ref).toBe(contract.METHODS_SOURCE_COMMIT);
    expect(action.description).toContain(
      `ABI ${contract.METHODS_ABI_MAJOR}.${contract.METHODS_ABI_MINOR}`,
    );
  });

  it("keeps full E2E local while smoking the payload, the first launch and a SHAP journey of every built installer", () => {
    expect(fs.existsSync(".github/workflows/playwright.yml")).toBe(false);
    for (const name of ["installer-linux", "installer-windows", "installer-macos-arm64"]) {
      const steps = release.jobs[name].steps!;
      const smoke = steps.filter(step => step.run?.includes("scripts/smoke-archive-standalone.cjs"));
      expect(smoke, name).toHaveLength(1);
      // Every leg is smoked: the offline one proves an environment created from the payload alone.
      expect(smoke[0].if, name).toBeUndefined();
      expect(smoke[0]["continue-on-error"], name).not.toBe(true);
      expect(smoke[0].run).toContain("scripts/smoke-packaged-ui.cjs");
      expect(smoke[0].run).toContain("--installer");
      expect(smoke[0].run?.match(/--timeout-ms 240000/g), name).toHaveLength(2);
      expect(smoke[0].env?.RELEASE_SOURCE_SHA).toBe("${{ needs.prepare.outputs.checkout_ref }}");
      expect(smoke[0].env?.RELEASE_VERSION).toBe("${{ needs.prepare.outputs.version }}");
      expect(smoke[0].env?.NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY).toBe("github-observational");
      const staged = steps.findIndex(step => step.run?.includes("scripts/fetch-uv.cjs"));
      const packaged = steps.findIndex(step => step.run?.includes("npx electron-builder --config"));
      expect(staged, name).toBeGreaterThan(0);
      expect(steps[staged].run).toContain("scripts/studio-document-adapters.cjs --install backend-dist/adapters");
      expect(packaged, name).toBeGreaterThan(staged);
      expect(steps.indexOf(smoke[0]), name).toBeGreaterThan(packaged);
      const offline = steps.findIndex(step => step.run?.includes("scripts/build-offline-payload.cjs"));
      if (name === "installer-macos-arm64") {
        // A macOS application embeds no wheels and has no offline leg: its required packages come from the package index.
        expect(offline, name).toBe(-1);
        expect(release.jobs[name].strategy, name).toBeUndefined();
        expect(steps[staged].run).not.toContain("scripts/build-wheelhouse.cjs");
        expect(steps[staged].run).toContain("test ! -e backend-dist/wheels");
        expect(steps[packaged].run).toContain("--config electron-builder.installer.yml --mac --arm64");
        expect(steps.find(step => step.name === "Upload artifacts")!.with?.path).not.toContain("wheels");
      } else {
        expect(steps[staged].run).toContain("scripts/build-wheelhouse.cjs");
        expect(steps[offline].if, name).toBe("matrix.variant == 'offline'");
        expect(offline, name).toBeGreaterThan(staged);
        expect(packaged, name).toBeGreaterThan(offline);
        expect(steps[packaged].run).toContain("--config ${{ matrix.builder_config }}");
      }
    }
    const action = yaml.load(fs.readFileSync('.github/actions/publish-installer-channel/action.yml', 'utf8')) as unknown as { runs: { steps: Step[] } };
    expect(action.runs.steps[0].uses).toBe('actions/download-artifact@v4');
    expect(action.runs.steps[1].run).toContain('scripts/stage-release-channel.cjs');
    expect(action.runs.steps[2].run).toContain('scripts/publish-qualified-release.cjs');
    expect(JSON.stringify(action)).not.toContain('wheels.tar.gz');
    const remoteCommands = Object.values(release.jobs).flatMap(job => job.steps ?? []).map(step => step.run ?? "").join("\n");
    for (const fullJourney of ["installed_multimodal_provider.py", "test:native-archive-v2", "npx playwright test"]) {
      expect(remoteCommands).not.toContain(fullJourney);
    }
  });

  it("keeps the multimodal candidate lane manual, nonpublishing and on the product's own wheel mechanism", () => {
    const source = fs.readFileSync(".github/workflows/multimodal-package-candidate.yml", "utf8");
    const lane = yaml.load(source) as Workflow & { permissions: unknown };
    expect(Object.keys(lane.on)).toEqual(["workflow_dispatch"]);
    expect(lane.permissions).toEqual({ contents: "read" });
    const steps = Object.values(lane.jobs).flatMap(job => job.steps ?? []);
    for (const job of Object.values(lane.jobs)) expect((job as { permissions?: unknown }).permissions).toBeUndefined();
    // No action of the lane can publish: these build, read and keep workflow artifacts.
    expect([...new Set(steps.flatMap(step => step.uses ?? []))].sort()).toEqual([
      "./.github/actions/build-native-methods", "actions/checkout@v4", "actions/download-artifact@v4", "actions/setup-node@v4",
      "actions/setup-python@v5", "actions/upload-artifact@v4", "dtolnay/rust-toolchain@stable",
    ]);
    expect(source).not.toContain("secrets.");
    const commands = steps.map(step => step.run ?? "").join("\n");
    for (const publication of ["gh release", "docker push", "git push", "git tag", "npm publish", "twine", "--publish always"]) {
      expect(commands).not.toContain(publication);
    }
    // Every Studio script the lane runs exists: it once outlived the scripts it called.
    const scripts = [...source.matchAll(/(?:node|python) (scripts\/[\w.-]+\.(?:cjs|py))/g)].map(match => match[1]);
    for (const [, pattern] of source.matchAll(/unittest discover -s scripts -p '([\w.-]+)'/g)) scripts.push(`scripts/${pattern}`);
    expect(scripts).toEqual(expect.arrayContaining([
      "scripts/prepare-multimodal-package-candidate.cjs", "scripts/smoke-multimodal-ui.cjs", "scripts/test_verify_installed_candidate_wheels.py",
    ]));
    const candidateRepositoryScripts = ["scripts/prepare_python_candidate.py", "scripts/validate_release_metadata.py"];
    for (const script of new Set(scripts)) {
      if (!candidateRepositoryScripts.includes(script)) expect(fs.existsSync(script), script).toBe(true);
    }
    for (const name of ["linux-package", "windows-package"]) {
      const jobSteps = lane.jobs[name].steps!;
      const order = [
        "scripts/prepare-multimodal-package-candidate.cjs", "scripts/build-wheelhouse.cjs",
        "--require-python-payload", "--publish never", "scripts/smoke-archive-standalone.cjs", "scripts/smoke-multimodal-ui.cjs",
      ].map(marker => jobSteps.findIndex(step => step.run?.includes(marker)));
      expect(order.every(index => index >= 0), `${name}: ${order}`).toBe(true);
      expect(order, name).toEqual([...order].sort((left, right) => left - right));
      expect(jobSteps.filter(step => step.run?.includes("electron-builder")).every(step => step.run!.includes("--publish never")), name).toBe(true);
      // The environment made from the shipped payload and the one Studio creates are both compared with the candidates.
      expect(jobSteps.filter(step => step.run?.includes("scripts/verify-installed-candidate-wheels.py")), name).toHaveLength(2);
    }
  });

  it("publishes each delivery only after its own smoke and common source gates succeed", () => {
    for (const name of ["installer-linux", "installer-windows", "installer-macos-arm64", "docker"]) {
      const job = release.jobs[name];
      expect(dependencies(job)).toEqual(name === "docker" ? ["prepare", "quality"] : ["prepare", "quality", "release-draft"]);
      expect(releaseGate(name)).toBe(true);
      for (const prerequisite of dependencies(job)) expect(releaseGate(name, { [prerequisite]: "failure" })).toBe(false);
      const promotionName = name === "installer-linux" ? "publish-linux" : name === "installer-macos-arm64" ? "publish-macos-arm64" : name;
      const promotion = release.jobs[promotionName];
      const publish = promotion.steps!.find(step => step.name?.startsWith('Publish this qualified') || step.name === 'Publish the tested Docker image')!;
      expect(publish.if).toContain('success()');
      expect(publish.if).toContain("needs.quality.result == 'success'");
      expect(publish.if).toContain("needs.prepare.outputs.is_tag_release == 'true'");
      expect(publish["continue-on-error"]).not.toBe(true);
      const smoke = job.steps!.findIndex(step => step.run?.includes(name === 'docker' ? 'smoke-docker-native-runtime.sh' : 'smoke-packaged-ui.cjs'));
      expect(smoke).toBeGreaterThanOrEqual(0);
      if (promotion === job) expect(smoke).toBeLessThan(job.steps!.indexOf(publish));
      else {
        expect(dependencies(promotion)).toContain(name);
        expect(dependencies(promotion)).toContain("installer-windows");
        expect(publish.with?.artifact).toBe(job.steps!.find(step => step.name === "Upload artifacts")!.with?.name);
      }
    }
  });

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
    expect(steps[smokeIndex].if).toBe("inputs.delivery_source_only != true");
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
        const script = summary.replace(/\$\{\{ needs\.([\w-]+)\.result \}\}/g, (_, job: string) => job === failedJob ? outcome : "success")
          .replaceAll("${{ inputs.delivery_source_only }}", "false");
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
    expect(writers).toHaveLength(3);
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
    for (const publisher of ["installer-linux", "installer-windows", "installer-macos-arm64", "docker"]) {
      expect(dependencies(release.jobs[publisher])).toContain("quality");
    }
    const installers = Object.entries(release.jobs).filter(([name]) => name.startsWith("installer-"));
    expect(installers.map(([name]) => name)).toEqual(["installer-linux", "installer-windows", "installer-macos-arm64"]);
    for (const [name, job] of installers) {
      expect(dependencies(job), name).toEqual(["prepare", "quality", "release-draft"]);
      const upload = job.steps!.find(step => step.name === "Upload artifacts")!;
      if (name === "installer-macos-arm64") {
        expect(upload.with?.name, name).toBe("installer-macos-arm64-payload");
        continue;
      }
      expect(job.strategy?.matrix, name).toBe(name === 'installer-linux'
        ? '${{ fromJSON(needs.prepare.outputs.linux_matrix) }}'
        : '${{ fromJSON(needs.prepare.outputs.windows_matrix) }}');
      expect(upload.with?.name, name).toMatch(/^installer-[a-z0-9-]+-\$\{\{ matrix\.variant \}\}-payload$/);
    }
    expect(Object.keys(release.jobs)).not.toContain("pinned-plugin-wheels");
  });

  it("blocks a delivery when its required source gate fails or is skipped", () => {
    for (const publisher of ["installer-linux", "installer-windows", "installer-macos-arm64", "docker"]) {
      expect(releaseGate(publisher)).toBe(true);
      for (const prerequisite of dependencies(release.jobs[publisher])) {
        for (const outcome of ["failure", "cancelled", "skipped"]) {
          expect(releaseGate(publisher, { [prerequisite]: outcome }), `${publisher}: ${prerequisite} ${outcome}`).toBe(false);
        }
      }

    }
    expect(releaseGate("docker", {}, { skip_docker: "true" })).toBe(false);
    expect(releaseGate("installer-windows", { docker: "skipped" }, { skip_docker: "true" })).toBe(true);
  });

  it.skipIf(process.platform === "win32")("promotes the exact tested Docker candidate and reserves latest for stable releases", () => {
    const steps = release.jobs.docker.steps!;
    const publication = steps.find((step) => step.run?.includes("docker push"))!;
    expect(publication.if).toBe("success() && needs.prepare.outputs.is_tag_release == 'true' && needs.quality.result == 'success'");
    const root = temporaryDirectory();
    const log = path.join(root, "docker-calls");
    const fakeDocker = path.join(root, "docker");
    fs.writeFileSync(fakeDocker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_TEST_LOG"\nif [ "$1" = image ]; then echo sha256:tested; fi\n');
    fs.chmodSync(fakeDocker, 0o700);
    for (const prerelease of ["true", "false"]) {
      fs.writeFileSync(log, "");
      const result = spawnSync("bash", ["-e", "-c", publication.run!], {
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, DOCKER_TEST_LOG: log, RELEASE_VERSION: "1.2.3", IS_PRERELEASE: prerelease, EXPECTED_IMAGE_ID: "sha256:tested" },
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      const calls = fs.readFileSync(log, "utf8").trim().split("\n");
      const expected = [
        "image inspect --format {{.Id}} nirs4all-studio:native-release-candidate",
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
