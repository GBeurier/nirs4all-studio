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
      expect(job.needs).toBe('prepare');
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
    expect(release.jobs.release.needs).toEqual(['prepare', 'quality', 'installer-linux', 'installer-windows', 'installer-macos-arm64', 'docker']);
  });

  it('builds Docker concurrently and publishes only the image tested before the join', () => {
    expect(release.jobs.docker.needs).toBe('prepare');
    expect(release.jobs.docker.steps.some((step: { run?: string }) => step.run?.includes('docker push'))).toBe(false);
    const publish = release.jobs.release.steps.find((step: { name?: string }) => step.name === 'Publish the tested Docker image');
    expect(publish.run).toContain('docker load');
    expect(publish.run).toContain('EXPECTED_IMAGE_ID');
    expect(publish.run).not.toContain('docker build');
  });

  it('refuses publication when any product or quality job fails, is cancelled or skipped', () => {
    for (const failed of ['quality', ...installers, 'docker']) {
      for (const result of ['failure', 'cancelled', 'skipped']) {
        const expression = release.jobs.release.if.replace(/always\(\)/g, 'true')
          .replace(/needs\.prepare\.outputs\.skip_docker/g, '\'false\'')
          .replace(/needs\.([\w-]+)\.result/g, (_: string, job: string) => JSON.stringify(job === failed ? result : 'success'));
        expect(runInNewContext(expression), `${failed}: ${result}`).toBe(false);
      }
    }
  });

  it('builds macOS for Apple Silicon only, with no optional Intel installer', () => {
    expect(release.on.workflow_dispatch.inputs.include_macos_x64).toBeUndefined();
    expect(Object.keys(release.jobs).filter(name => name.startsWith('installer-macos'))).toEqual(['installer-macos-arm64']);
    expect(JSON.stringify(release)).not.toMatch(/macos-x64|mac-x64|macos-15-intel|x86_64-apple-darwin/);
  });
});
