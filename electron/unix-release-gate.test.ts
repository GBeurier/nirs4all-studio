import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { UNIX_PLATFORMS, previousUnixReleasePlan, assertUnixCandidateProvenance, assertUnixBaseline } = require('../scripts/unix-release-gate-plan.cjs');
const options = { archiveEnabled: true };
const suffixes = ['linux-x64.tar.gz', 'mac-arm64.zip', 'mac-x64.zip'];
const stable = (version: string, platforms = suffixes) => ({
  id: Number(version.split('.').at(-1)) + 100, tag_name: version, draft: false, prerelease: false, published_at: '2026-09-17T12:00:00Z',
  assets: platforms.flatMap(suffix => [`nirs4all.Studio-${version}-all-in-one-${suffix}`, `nirs4all.Studio-${version}-all-in-one-${suffix}.sha256`])
    .map((name, index) => ({ name, size: 100, state: 'uploaded', id: index + 1 })),
});
describe('platform-specific public Unix migration baselines', () => {
  it('selects public 0.11.4 for Intel while Linux and arm64 migrate from 0.11.5', () => {
    const plan = previousUnixReleasePlan([stable('0.11.4'), stable('0.11.5', suffixes.slice(0, 2))], '0.11.6', options);
    expect(plan.map((platform: { artifact: string; from_version: string }) => [platform.artifact, platform.from_version]))
      .toEqual([['linux-x64', '0.11.5'], ['macos-arm64', '0.11.5'], ['macos-x64', '0.11.4']]);
    expect(plan[2]).toMatchObject({ source_release_id: 104, source_archive_id: 5, source_checksum_id: 6 });
  });

  it('orders semantic versions numerically and excludes draft, prerelease and nonnumeric tags', () => {
    const history = [stable('0.9.9'), stable('0.10.1'), { ...stable('0.11.0'), draft: true },
      { ...stable('0.11.1'), prerelease: true }, { ...stable('0.11.2'), published_at: null }, stable('nightly')];
    expect(previousUnixReleasePlan(history, '0.12.0', options).every((platform: { from_version: string }) => platform.from_version === '0.10.1')).toBe(true);
  });

  it('refuses partial or ambiguous public archives instead of silently falling back', () => {
    for (const mutation of ['missing-checksum', 'empty', 'uploading', 'duplicate']) {
      const current = stable('0.11.5');
      if (mutation === 'missing-checksum') current.assets.splice(1, 1);
      if (mutation === 'empty') current.assets[0].size = 0;
      if (mutation === 'uploading') current.assets[0].state = 'new';
      if (mutation === 'duplicate') current.assets.push(current.assets[0]);
      expect(() => previousUnixReleasePlan([current, stable('0.11.4')], '0.11.6', options), mutation).toThrow(/Incomplete public/);
    }
  });

  it('requires an actual baseline for every platform and a strictly newer stable target', () => {
    expect(() => previousUnixReleasePlan([], '0.11.6', options)).toThrow(/No stable public/);
    expect(() => previousUnixReleasePlan([stable('0.11.5', suffixes.slice(0, 2))], '0.11.6', options)).toThrow(/macOS x64/);
    expect(() => previousUnixReleasePlan([stable('0.11.5')], '0.11.5', options)).toThrow(/newer/);
    expect(() => previousUnixReleasePlan([stable('0.11.5')], '0.11.6-beta.1', options)).toThrow(/stable numeric/);
    for (const tagRelease of [true, false]) {
      expect(() => previousUnixReleasePlan([stable('0.11.5')], '0.11.6', { archiveEnabled: false, tagRelease })).toThrow(/require Unix update archives/);
    }
  });

  it('detects baseline release or asset replacement between preparation and qualification', () => {
    const source = stable('0.11.4');
    const platform = previousUnixReleasePlan([source], '0.11.6', options)[2];
    expect(() => assertUnixBaseline(source, platform)).not.toThrow();
    expect(() => assertUnixBaseline({ ...source, id: source.id + 1 }, platform)).toThrow(/release was replaced/);
    const changed = structuredClone(source);
    changed.assets[4].id += 100;
    expect(() => assertUnixBaseline(changed, platform)).toThrow(/archive was replaced/);
    changed.assets[4].id -= 100;
    changed.assets[5].id += 100;
    expect(() => assertUnixBaseline(changed, platform)).toThrow(/checksum was replaced/);
    expect(() => assertUnixBaseline({ ...source, draft: true }, platform)).toThrow(/stable and public/);
  });
});

describe('candidate source and same-run producer provenance', () => {
  const candidate = () => ({
    run: { id: 123, path: '.github/workflows/release-unified.yml', event: 'push', head_branch: '0.11.6', head_sha: 'a'.repeat(40) },
    jobs: ['Installer — macOS x64', 'All-in-one — macOS x64'].map(name => ({ name, status: 'completed', conclusion: 'success' })),
    context: { runId: '123', currentRunId: '123', checkoutRef: 'a'.repeat(40), targetVersion: '0.11.6', platformLabel: 'macOS x64' },
  });

  it('consumes completed producers even though the containing release run is not complete', () => {
    const { run, jobs, context } = candidate();
    expect(() => assertUnixCandidateProvenance({ ...run, status: 'in_progress', conclusion: null }, jobs, context)).not.toThrow();
    expect(() => assertUnixCandidateProvenance({ ...run, event: 'workflow_dispatch', head_branch: 'main', head_sha: 'b'.repeat(40) }, jobs, context)).not.toThrow();
  });

  it('rejects another run, product SHA, version, workflow, or missing producer', () => {
    const { run, jobs, context } = candidate();
    expect(() => assertUnixCandidateProvenance(run, jobs, { ...context, currentRunId: '124' })).toThrow(/own producer run/);
    for (const patch of [{ id: 124 }, { head_sha: 'b'.repeat(40) }, { head_branch: '0.11.5' }, { path: '.github/workflows/other.yml' }, { event: 'pull_request' }]) {
      expect(() => assertUnixCandidateProvenance({ ...run, ...patch }, jobs, context)).toThrow();
    }
    expect(() => assertUnixCandidateProvenance(run, jobs.slice(0, 1), context)).toThrow(/Missing or ambiguous/);
    expect(() => assertUnixCandidateProvenance(run, [...jobs, jobs[0]], context)).toThrow(/Missing or ambiguous/);
  });

  it('refuses failed, cancelled, skipped or unfinished builds', () => {
    const { run, jobs, context } = candidate();
    for (const conclusion of ['failure', 'cancelled', 'skipped']) {
      expect(() => assertUnixCandidateProvenance(run, [jobs[0], { ...jobs[1], conclusion }], context)).toThrow(/Unqualified/);
    }
    expect(() => assertUnixCandidateProvenance(run, [jobs[0], { ...jobs[1], status: 'in_progress' }], context)).toThrow(/Unfinished/);
  });
});
