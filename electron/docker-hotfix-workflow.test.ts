import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/publish-qualified-docker-hotfix.yml', import.meta.url), 'utf8');
const step = (name: string) => {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  expect(start, `Missing step: ${name}`).toBeGreaterThanOrEqual(0);
  const end = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
};

describe('independent Docker 0.11.5 hotfix qualification and publication', () => {
  it('fails qualification when a scientific smoke fails before tee and never runs the next probe', () => {
    const parsed = createRequire(import.meta.url)('js-yaml').load(workflow);
    expect(parsed.defaults.run.shell).toBe('bash');
    const qualify = parsed.jobs.docker.steps.find((entry: { name?: string }) => entry.name === 'Verify image identity and qualify actual container and Chromium access');
    const cwd = mkdtempSync(path.join(tmpdir(), 'studio-docker-gate-'));
    try {
      const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', [
        'docker() { echo "{}"; }',
        'node() { if [[ "$*" == *"--browser"* ]]; then touch browser-ran; fi; }',
        'bash() { return 17; }',
        qualify.run,
      ].join('\n')], { cwd, encoding: 'utf8' });
      expect(result.status).toBe(17);
      expect(existsSync(path.join(cwd, 'browser-ran'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('pins product checkout and requires source quality, exact E2E and an existing stable release', () => {
    expect(workflow).toContain('ref: f314cdb223cd77ce1a3fb6d336cca82206cd02a4');
    const gate = step('Verify exact source and existing public stable release');
    expect(gate).toContain("release.tag_name !== '0.11.5' || release.draft || release.prerelease");
    expect(gate).toContain("tag.type !== 'commit' || tag.sha !== sha");
    expect(gate).toContain('run_id:35216053291');
    expect(gate).toContain('105184723359,105184723431,105184723339,105184723363');
    expect(gate).toContain('run_id:35216025664');
    expect(gate).toContain("e2e.head_sha !== sha || e2e.conclusion !== 'success'");
  });

  it('builds once and records version and revision before actual container and browser qualification', () => {
    expect(workflow.match(/\bdocker build\b/g)).toHaveLength(1);
    const build = step('Build release image once');
    expect(build).toContain('--build-arg STUDIO_VERSION="$RELEASE_VERSION"');
    expect(build).toContain('--build-arg STUDIO_REVISION="$PRODUCT_SHA"');
    const qualify = step('Verify image identity and qualify actual container and Chromium access');
    expect(qualify).toContain('b.version!==process.env.RELEASE_VERSION');
    expect(qualify).toContain('b.revision!==process.env.PRODUCT_SHA');
    expect(qualify).toContain('smoke-docker-native-runtime.sh "$CANDIDATE"');
    expect(qualify).toContain('test-docker-access.cjs "$CANDIDATE" --browser');
    expect(workflow.indexOf(build)).toBeLessThan(workflow.indexOf(qualify));
  });

  it('preserves reusable qualified bytes before allowing a registry mutation', () => {
    const preserve = step('Preserve exact qualified bytes before publication');
    expect(preserve).toContain('docker save "$CANDIDATE"');
    expect(preserve).toContain('sha256sum qualified-image.tar.gz');
    const upload = step('Upload reusable qualified image and proof');
    expect(upload).toContain('if-no-files-found: error');
    expect(workflow.indexOf(preserve)).toBeLessThan(workflow.indexOf(upload));
    expect(workflow.indexOf(upload)).toBeLessThan(workflow.indexOf(step('Login to GitHub Container Registry')));
    for (const name of ['Login to GitHub Container Registry', 'Publish and verify the exact qualified image']) {
      expect(step(name)).toContain('if: inputs.publish');
    }
    expect(workflow).toContain('default: false');
  });

  it('refuses an existing version immediately and again before pushing, without replacing 0.11.4', () => {
    const guard = step('Refuse an existing public 0.11.5 Docker tag');
    expect(guard).toContain('response.status !== 404');
    expect(guard).toContain('AbortSignal.timeout(30000)');
    expect(guard).toContain('node "$RUNNER_TEMP/assert-docker-hotfix-tag-absent.cjs"');
    const publish = step('Publish and verify the exact qualified image');
    expect(publish).toContain('node "$RUNNER_TEMP/assert-docker-hotfix-tag-absent.cjs"');
    expect(publish).not.toContain('0.11.4');
    expect(publish).not.toMatch(/\bdocker (build|manifest rm)\b/);
    expect(workflow).not.toMatch(/gh release|repos\.updateRelease|repos\.createRelease/);
  });

  it('checks published version identity before advancing latest and records registry identities', () => {
    const publish = step('Publish and verify the exact qualified image');
    const versionVerified = publish.indexOf('test "$(docker image inspect "$IMAGE:$RELEASE_VERSION"');
    const latestTagged = publish.indexOf('docker tag "$CANDIDATE" "$IMAGE:latest"');
    expect(versionVerified).toBeGreaterThanOrEqual(0);
    expect(latestTagged).toBeGreaterThan(versionVerified);
    expect(publish).toContain('test "$(docker image inspect "$IMAGE:latest" --format');
    expect(publish).toContain('published-image-inspect.json');
  });
});
