import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const release = require('js-yaml').load(readFileSync('.github/workflows/release-unified.yml', 'utf8'));
const installers = ['installer-windows', 'installer-linux', 'installer-macos-arm64'];

describe('installer product qualification and publication', () => {
  it('smokes the payload and the first launch of each packaged application on its own runner before uploading it', () => {
    for (const name of installers) {
      const job = release.jobs[name];
      expect(job.needs).toEqual(['prepare', 'quality', 'release-draft']);
      const gate = job.steps.findIndex((step: { run?: string }) => step.run?.includes('smoke-archive-standalone.cjs'));
      const upload = job.steps.findIndex((step: { name?: string }) => step.name === 'Upload artifacts');
      expect(gate).toBeGreaterThan(0);
      expect(upload).toBeGreaterThan(gate);
      expect(job.steps[gate].if).toBeUndefined();
      expect(job.steps[gate]['continue-on-error']).not.toBe(true);
      expect(job.steps[gate].run).toContain('smoke-packaged-ui.cjs');
      expect(job.steps[gate].run).toContain('--installer');
      expect(job.steps[gate].env.RELEASE_SOURCE_SHA).toContain('checkout_ref');
      expect(job.steps[gate].run).toMatch(/Expected exactly one NSIS installer|test "\$\{#installers\[@\]\}" = 1/);
    }
  });

  it('has no archive producers or archive prerequisite for stable publication', () => {
    expect(Object.keys(release.jobs).filter(name => name.startsWith('archive-'))).toEqual([]);
    expect(release.on.workflow_dispatch.inputs.skip_all_in_one).toBeUndefined();
    expect(release.jobs.release).toBeUndefined();
    for (const producer of installers) expect(release.jobs[producer].needs).toEqual(['prepare', 'quality', 'release-draft']);
    expect(release.jobs.docker.needs).toEqual(['prepare', 'quality']);
  });

  it('publishes only the Docker image qualified in its own job', () => {
    const steps = release.jobs.docker.steps;
    const publish = steps.find((step: { name?: string }) => step.name === 'Publish the tested Docker image');
    expect(publish.run).toContain('EXPECTED_IMAGE_ID');
    expect(publish.run).not.toContain('docker build');
    expect(publish.run).not.toContain('docker load');
    expect(steps.findIndex((step: { run?: string }) => step.run?.includes('smoke-docker-native-runtime.sh')))
      .toBeLessThan(steps.indexOf(publish));
  });

  it('requires shared quality and a successful publication step for every channel', () => {
    for (const name of ['publish-linux', 'installer-windows', 'publish-macos-arm64', 'docker']) {
      const job = release.jobs[name];
      const publish = job.steps.find((step: { name?: string }) => step.name?.startsWith('Publish this qualified') || step.name === 'Publish the tested Docker image');
      expect(publish.if).toContain('success()');
      expect(publish.if).toContain("needs.quality.result == 'success'");
      expect(publish.if).toContain("needs.prepare.outputs.is_tag_release == 'true'");
      expect(publish['continue-on-error']).not.toBe(true);
      for (const ownSuccess of [false, true]) {
        for (const quality of ['success', 'failure', 'cancelled', 'skipped']) {
          const expression = publish.if.replace(/success\(\)/g, String(ownSuccess))
            .replace(/needs\.quality\.result/g, JSON.stringify(quality))
            .replace(/needs\.prepare\.outputs\.is_tag_release/g, "'true'");
          expect(runInNewContext(expression)).toBe(ownSuccess && quality === 'success');
        }
      }
    }
  });

  it('builds macOS for Apple Silicon only, with no optional Intel installer', () => {
    expect(release.on.workflow_dispatch.inputs.include_macos_x64).toBeUndefined();
    expect(Object.keys(release.jobs).filter(name => name.startsWith('installer-macos'))).toEqual(['installer-macos-arm64']);
    expect(JSON.stringify(release)).not.toMatch(/macos-x64|mac-x64|macos-15-intel|x86_64-apple-darwin/);
  });
});
