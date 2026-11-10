const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../../.github/workflows/publish-existing-installers.yml'), 'utf8'));
const steps = workflow.jobs.publish.steps;
const source = '41a984cfb904987ed5a772d2caaa0fa217a00a2c';
const retry = 'd22901cc0237c548029dd371f7416ef0e1f079fa';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function qualify(change = {}) {
  const required = ['Qualify release commit / Frontend', 'Qualify release commit / Backend',
    'Qualify release commit / Native Docker Runtime', 'Qualify release commit / Native Sidecar Windows Containment',
    'Qualify release commit / Electron Build Test', 'Qualify release commit / CI Summary', 'Native Docker Image',
    'Installer — Linux x64', 'Installer — Windows x64'];
  const job = name => ({ name, conclusion: change.failedJob === name ? 'failure' : 'success', steps: [
    { name: 'Smoke packaged UI and runtime contract', conclusion: 'success' }, { name: 'Upload artifacts', conclusion: 'success' },
  ] });
  const github = { rest: { actions: {
    getWorkflowRun: async ({ run_id }) => ({ data: { head_sha: run_id === 42845474685 ? (change.source || source) : retry,
      path: '.github/workflows/release-unified.yml', status: 'completed', conclusion: 'success' } }),
    listJobsForWorkflowRun: 'jobs',
  }, git: { getRef: async () => ({ data: { object: { type: 'commit', sha: change.tag || source } } }) } },
  paginate: async (_method, { run_id }) => run_id === 42845474685 ? required.map(job)
    : [{ ...job('Installer — macOS arm64'), ...(change.missingMacSmoke ? { steps: [] } : {}) }], };
  const script = steps.find(step => step.name === 'Verify retained build identities and successful platform checks').with.script;
  await new AsyncFunction('github', 'context', 'process', script)(github, { repo: { owner: 'GBeurier', repo: 'nirs4all-studio' } },
    { env: { RELEASE_SHA: source, MACOS_RETRY_RUN: '42' } });
}

test('retained installer promotion requires the exact full source checks and platform smokes', () => qualify());
test('a failed backend source check blocks retained installer promotion', () =>
  assert.rejects(qualify({ failedJob: 'Qualify release commit / Backend' }), /Required source qualification failed/));
test('a different original source or moved application tag blocks promotion', async () => {
  await assert.rejects(qualify({ source: 'a'.repeat(40) }), /Unexpected original release identity/);
  await assert.rejects(qualify({ tag: 'a'.repeat(40) }), /Immutable application tag mismatch/);
});
test('a successful macOS build without the packaged SHAP smoke blocks promotion', () =>
  assert.rejects(qualify({ missingMacSmoke: true }), /Missing installer qualification/));

test('packaged SHAP evidence must explain the captured prediction before publication', () => {
  const script = steps.find(step => step.name === 'Verify exact installers and their actual packaged SHAP evidence').run
    .split("node <<'NODE'\n")[1].split('\nNODE')[0];
  const proof = { success: true, source_sha: source, packaged_version: { commit: source, version: '0.15.11' },
    embedded_sdk: { source_sha: 'b', wheel_sha256: 'c' },
    shap: { success: true, blocked_job_websockets: 1, restored_results: true, captured_prediction_additivity: false } };
  const run = additive => vm.runInNewContext(script, { process: { env: { RELEASE_SHA: source, RELEASE_TAG: '0.15.11' } },
    require: name => name === 'node:assert/strict' ? assert : name === 'node:fs'
      ? { readFileSync: file => JSON.stringify({ ...proof, platform: file.includes('windows') ? 'win32' : file.includes('macos') ? 'darwin' : 'linux',
        shap: { ...proof.shap, captured_prediction_additivity: additive }, installer: { name: 'candidate', sha256: 'd' } }) }
      : name.endsWith('runtime-cohort.json') ? { sdk: { source_sha: 'b', wheel_sha256: 'c' } }
        : { canonicalPublishedName: String, sha256File: () => 'd' } });
  assert.throws(() => run(false), /false !== true/);
  run(true);
});
test('retained artifact publisher shell steps parse before dispatch', () => {
  for (const step of steps.filter(step => step.run)) {
    const result = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
    assert.equal(result.status, 0, step.name + ': ' + result.stderr);
  }
});
