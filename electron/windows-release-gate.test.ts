import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const release = require('js-yaml').load(readFileSync('.github/workflows/release-unified.yml', 'utf8'));
const installers = ['installer-windows', 'installer-linux', 'installer-macos-x64', 'installer-macos-arm64'];

describe('installer product qualification and publication', () => {
  it('smokes each actual packaged UI on its own runner before uploading its payload', () => {
    for (const name of installers) {
      const job = release.jobs[name];
      expect(job.needs).toEqual(['prepare', 'pinned-plugin-wheels']);
      const gate = job.steps.findIndex((step: { run?: string }) => step.run?.includes('smoke-packaged-ui.cjs'));
      const upload = job.steps.findIndex((step: { name?: string }) => step.name === 'Upload artifacts');
      expect(gate).toBeGreaterThan(0);
      expect(upload).toBeGreaterThan(gate);
      expect(job.steps[gate].if).toBeUndefined();
      expect(job.steps[gate]['continue-on-error']).not.toBe(true);
      expect(job.steps[gate].run).toContain('--installer');
      expect(job.steps[gate].run).toContain('--timeout-ms 120000');
      expect(job.steps[gate].env.RELEASE_SOURCE_SHA).toContain('checkout_ref');
    }
  });

  it('has no archive producers or archive prerequisite for stable publication', () => {
    expect(Object.keys(release.jobs).filter(name => name.startsWith('archive-'))).toEqual([]);
    expect(release.on.workflow_dispatch.inputs.skip_all_in_one).toBeUndefined();
    expect(release.jobs.release.needs).toEqual(['prepare', 'quality', ...['installer-linux', 'installer-windows', 'installer-macos-x64', 'installer-macos-arm64'], 'docker']);
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
          .replace(/needs\.prepare\.outputs\.include_macos_x64/g, '\'true\'')
          .replace(/needs\.([\w-]+)\.result/g, (_: string, job: string) => JSON.stringify(job === failed ? result : 'success'));
        expect(runInNewContext(expression), `${failed}: ${result}`).toBe(false);
      }
    }
  });

  it('allows an explicitly skipped Intel installer while all required products remain blocking', () => {
    expect(release.on.workflow_dispatch.inputs.include_macos_x64.default).toBe(false);
    expect(release.jobs['installer-macos-x64'].if).toBe("needs.prepare.outputs.include_macos_x64 == 'true'");
    const evaluate = (failed?: string, result = 'failure') => runInNewContext(release.jobs.release.if
      .replace(/always\(\)/g, 'true')
      .replace(/needs\.prepare\.outputs\.skip_docker/g, '\'false\'')
      .replace(/needs\.prepare\.outputs\.include_macos_x64/g, '\'false\'')
      .replace(/needs\.([\w-]+)\.result/g, (_: string, job: string) => JSON.stringify(
        job === failed ? result : job === 'installer-macos-x64' ? 'skipped' : 'success')));
    expect(evaluate()).toBe(true);
    for (const failed of ['quality', 'installer-windows', 'installer-linux', 'installer-macos-arm64', 'docker', 'installer-macos-x64']) {
      for (const result of ['failure', 'cancelled']) expect(evaluate(failed, result)).toBe(false);
    }
    for (const failed of ['quality', 'installer-windows', 'installer-linux', 'installer-macos-arm64', 'docker']) {
      expect(evaluate(failed, 'skipped')).toBe(false);
    }
  });
});
