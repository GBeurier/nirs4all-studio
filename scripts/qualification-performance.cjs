/** Hosted VM timings are observations; product budgets remain strict locally. */
const assert = require('node:assert/strict');

const FUNCTIONAL_TIMEOUT_MS = 120000;
const STRICT_POLICY = Object.freeze({ mode: 'strict', budgets_enforced: true });

function resolvePerformancePolicy(env = process.env) {
  const mode = env.NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY || 'strict';
  assert(['strict', 'github-observational'].includes(mode), `Unknown performance policy: ${mode}`);
  if (mode === 'strict') return STRICT_POLICY;
  assert(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted',
    'Observational performance requires an actual GitHub-hosted runner; local qualification is strict');
  return Object.freeze({ mode, budgets_enforced: false, runner_environment: env.RUNNER_ENVIRONMENT,
    functional_timeout_ms: FUNCTIONAL_TIMEOUT_MS });
}

function recordTiming(proof, phase, duration_ms, budget_ms) {
  const policy = proof.performance_policy || STRICT_POLICY;
  const over_budget = duration_ms > budget_ms;
  proof.timings.push({ phase, duration_ms, budget_ms, over_budget, performance_policy: policy.mode });
  if (over_budget) {
    const message = `${phase} took ${Math.round(duration_ms)}ms; budget ${budget_ms}ms`;
    if (policy.budgets_enforced) assert.fail(message);
    console.warn(`Performance observation (GitHub-hosted VM): ${message}`);
  }
}

async function timed(proof, phase, budget, callback) {
  const start = performance.now();
  const result = await callback();
  recordTiming(proof, phase, performance.now() - start, budget);
  return result;
}

function functionalTimeout(proof, localBudget) {
  return (proof.performance_policy || STRICT_POLICY).budgets_enforced
    ? localBudget : FUNCTIONAL_TIMEOUT_MS;
}

module.exports = { resolvePerformancePolicy, recordTiming, timed, functionalTimeout };
