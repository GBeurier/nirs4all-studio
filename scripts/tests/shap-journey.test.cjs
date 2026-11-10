const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../smoke-shap-journey.cjs'), 'utf8');

async function startJourney(readiness) {
  const requests = [], module = { exports: {} };
  const stop = new Error('Fixture reached dataset submission');
  vm.runInNewContext(source, {
    module, exports: module.exports, console, Date, AbortSignal,
    setTimeout: callback => callback(),
    require: name => name === 'node:fs' ? { mkdirSync() {}, writeFileSync() {} }
      : name === '@playwright/test' ? {} : require(name),
    fetch: async url => {
      const route = new URL(url).pathname;
      requests.push(route);
      if (route !== '/api/system/readiness') throw stop;
      return { ok: true, json: async () => readiness.shift() };
    },
  });
  let error;
  try { await module.exports.shapJourney({ page: {}, env: { NIRS4ALL_NATIVE_SIDECAR_PORT: '1234' } }, {}, '/fixture'); }
  catch (caught) { error = caught; }
  return { requests, error, stop };
}

test('the packaged SHAP journey waits for ML readiness before submitting any data or pipeline', async () => {
  const result = await startJourney([{ ml_ready: false, ml_loading: true }, { ml_ready: true, ml_loading: false }]);
  assert.equal(result.error, result.stop);
  assert.deepEqual(result.requests, ['/api/system/readiness', '/api/system/readiness', '/api/datasets/link']);
});
test('failed scientific initialization blocks SHAP qualification before any submission', async () => {
  const result = await startJourney([{ ml_ready: false, ml_loading: false }]);
  assert.match(result.error.message, /scientific host failed to initialize/);
  assert.deepEqual(result.requests, ['/api/system/readiness']);
});
