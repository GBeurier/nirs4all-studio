import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const release = yaml.load(readFileSync('.github/workflows/release-unified.yml', 'utf8'));
const windows = yaml.load(readFileSync('.github/workflows/windows-real-install-update.yml', 'utf8'));
const { previousReleasePlan } = require('../scripts/windows-release-gate-plan.cjs');
const dependencies = (name: string): string[] => {
  const needs = release.jobs[name].needs;
  return typeof needs === 'string' ? [needs] : needs ?? [];
};
const stable = () => ({
  tag_name: '0.11.5', draft: false, prerelease: false, published_at: '2026-09-17T12:00:00Z',
  assets: ['nirs4all.Studio-0.11.5-all-in-one-win-x64.zip', 'nirs4all.Studio-0.11.5-all-in-one-win-x64.zip.sha256']
    .map(name => ({ name, size: 100, state: 'uploaded' })),
});
const options = { archiveEnabled: true, tagRelease: true };

describe('mandatory Windows product qualification for future releases', () => {
  it('supports workflow_call with source/run/version inputs and retains manual validation', () => {
    expect(windows.on.workflow_dispatch).toBeDefined();
    expect(windows.on.workflow_dispatch.inputs.from_version).toMatchObject({ type: 'string', required: true });
    expect(windows.on.workflow_dispatch.inputs.from_version.default).toBeUndefined();
    const acquisition = windows.jobs['real-install-update'].steps.find((step: { id?: string }) => step.id === 'candidate');
    expect(acquisition.run).toContain('[string]::IsNullOrWhiteSpace($env:SOURCE_VERSION)');
    expect(acquisition.run).toContain('Manual validation requires from_version');
    for (const input of ['release_run_id', 'checkout_ref', 'to_version']) {
      expect(windows.on.workflow_call.inputs[input]).toMatchObject({ type: 'string', required: true });
    }
    expect(release.jobs['windows-product'].uses).toBe('./.github/workflows/windows-real-install-update.yml');
    expect(release.jobs['windows-product'].with.from_version).toBe('${{ needs.prepare.outputs.previous_version }}');
    expect(release.jobs['windows-product'].with.to_version).toBe('${{ needs.prepare.outputs.version }}');
  });

  it('has no dependency cycle and waits only for producer jobs, never its own run completion', () => {
    const visit = (name: string, ancestry: string[]) => {
      expect(ancestry, `cycle through ${name}`).not.toContain(name);
      for (const dependency of dependencies(name)) visit(dependency, [...ancestry, name]);
    };
    for (const name of Object.keys(release.jobs)) visit(name, []);
    expect(dependencies('windows-product')).toEqual(['prepare', 'installer-windows', 'archive-windows']);
    const scripts = windows.jobs['real-install-update'].steps.map((step: { run?: string }) => step.run || '').join('\n');
    expect(scripts).toContain('if (-not $env:CHECKOUT_REF) {');
    expect(scripts).not.toContain('gh run watch');
    expect(scripts).not.toContain('$run.conclusion');
  });

  it('blocks GitHub and Docker publication on a failed, skipped or cancelled Windows product gate', () => {
    for (const publisher of ['release', 'docker']) {
      expect(dependencies(publisher)).toContain('windows-product');
      for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
        const expression = release.jobs[publisher].if
          .replace(/always\(\)/g, 'true')
          .replace(/needs\.prepare\.outputs\.([\w_]+)/g, (_: string, name: string) => JSON.stringify(name === 'version' ? '0.11.6' : 'false'))
          .replace(/needs\.([\w-]+)\.result/g, (_: string, name: string) => JSON.stringify(name === 'windows-product' ? result : 'success'));
        expect(runInNewContext(expression), `${publisher}:${result}`).toBe(result === 'success');
      }
    }
  });

  it('leaves prerelease publication behavior unchanged without claiming the stable Windows migration gate', () => {
    expect(release.jobs['windows-product'].if).toContain("needs.prepare.outputs.prerelease != 'true'");
    const discovery = release.jobs.prepare.steps.find((step: { id?: string }) => step.id === 'previous_release');
    expect(discovery.if).toBe("steps.version.outputs.prerelease != 'true'");
    for (const publisher of ['release', 'docker']) {
      const expression = release.jobs[publisher].if
        .replace(/always\(\)/g, 'true')
        .replace(/needs\.prepare\.outputs\.([\w_]+)/g, (_: string, name: string) => JSON.stringify(name === 'version' ? '0.11.6-beta.1' : name === 'prerelease' ? 'true' : 'false'))
        .replace(/needs\.([\w-]+)\.result/g, (_: string, name: string) => JSON.stringify(name === 'windows-product' ? 'skipped' : 'success'));
      expect(runInNewContext(expression), publisher).toBe(true);
    }
    expect(() => previousReleasePlan(stable(), '0.11.6-beta.1', options)).toThrow(/stable target/);
  });

  it('retains actual NSIS, installed UI, archive SHA and N-1 migration steps in reusable execution', () => {
    const steps = windows.jobs['real-install-update'].steps;
    for (const command of ['Start-Process', 'smoke-archive-standalone.cjs', 'smoke-first-launch-ui.cjs']) {
      const step = steps.find((value: { run?: string }) => value.run?.includes(command));
      expect(step).toBeDefined();
      expect(step.if).toBeUndefined();
      expect(step['continue-on-error']).not.toBe(true);
    }
    expect(steps.find((step: { run?: string }) => step.run?.includes('verify-real-release-update.cjs')).if)
      .toBe("inputs.archive_enabled && inputs.from_version != ''");
  });

  it('uses the last public stable release with complete Windows artifacts', () => {
    expect(previousReleasePlan(stable(), '0.11.6', options).previousVersion).toBe('0.11.5');
    expect(() => previousReleasePlan({ ...stable(), assets: [] }, '0.11.6', options)).toThrow(/missing/);
    expect(() => previousReleasePlan({ ...stable(), draft: true }, '0.11.6', options)).toThrow(/public/);
    expect(() => previousReleasePlan({ ...stable(), prerelease: true }, '0.11.6', options)).toThrow(/public/);
    expect(() => previousReleasePlan(stable(), '0.11.5', options)).toThrow(/newer/);
  });

  it('records initial releases and archive-free dry runs explicitly without allowing an archive-free publication', () => {
    expect(previousReleasePlan(null, '0.1.0', options).previousVersion).toBe('');
    expect(() => previousReleasePlan(null, '0.1.0', { archiveEnabled: false, tagRelease: true })).toThrow(/require/);
    expect(previousReleasePlan(stable(), '0.11.6', { archiveEnabled: false, tagRelease: false }).note).toContain('not tested');
  });
});
