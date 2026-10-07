const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePerformancePolicy, recordTiming, timed, functionalTimeout } = require('../qualification-performance.cjs');

const hosted = { NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY: 'github-observational',
  GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };

test('local and unconfigured CI enforce budgets; only explicit hosted policy observes', () => {
  assert.equal(resolvePerformancePolicy({}).budgets_enforced, true);
  assert.equal(resolvePerformancePolicy({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }).budgets_enforced, true);
  assert.equal(resolvePerformancePolicy(hosted).budgets_enforced, false);
  assert.throws(() => resolvePerformancePolicy({ ...hosted, GITHUB_ACTIONS: 'false' }), /actual GitHub-hosted/);
  assert.throws(() => resolvePerformancePolicy({ ...hosted, RUNNER_ENVIRONMENT: 'self-hosted' }), /actual GitHub-hosted/);
  assert.throws(() => resolvePerformancePolicy({ NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY: 'ignore' }), /Unknown/);
});

test('a VM overrun remains in proof and warns while functional qualification continues', t => {
  const warnings = [];
  t.mock.method(console, 'warn', message => warnings.push(message));
  const proof = { timings: [], performance_policy: resolvePerformancePolicy(hosted) };
  recordTiming(proof, 'nonempty_predictions_ui', 5916.7492, 5000);
  assert.deepEqual(proof.timings[0], { phase: 'nonempty_predictions_ui', duration_ms: 5916.7492,
    budget_ms: 5000, over_budget: true, performance_policy: 'github-observational' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /5917ms; budget 5000ms/);
  recordTiming(proof, 'multimodal_installed_provider', 1000, 360000);
  assert.equal(proof.timings.length, 2);
  assert.equal(proof.timings[1].over_budget, false);
  assert.equal(warnings.length, 1);
});

test('local overrun still fails with its measurement retained, equality passes', () => {
  const proof = { timings: [] };
  recordTiming(proof, 'preview', 5000, 5000);
  assert.throws(() => recordTiming(proof, 'preview', 5001, 5000), /budget 5000ms/);
  assert.equal(proof.timings[1].over_budget, true);
  assert.equal(proof.timings[1].performance_policy, 'strict');
});

test('observational policy keeps bounded functional waits and propagates real errors', async () => {
  const proof = { timings: [], performance_policy: resolvePerformancePolicy(hosted) };
  assert.equal(functionalTimeout(proof, 5000), 120000);
  assert.equal(functionalTimeout({ timings: [] }, 5000), 5000);
  await assert.rejects(timed(proof, 'predictions', 5000, async () => {
    assert.fail('No finite cross-validation prediction score');
  }), /No finite cross-validation/);
  assert.deepEqual(proof.timings, []);
});
