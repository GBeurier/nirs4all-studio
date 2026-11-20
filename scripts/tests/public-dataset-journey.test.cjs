const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { publicDatasetJourney, verifyReadback, responseForAction } = require('../smoke-public-dataset-journey.cjs');
const { datasets: selectedOwner } = require('../../build/runtime-cohort.json');

const profiles = [
  { id: 'canopy_treatment_2009_2016_to_cedar_ecosis', features: 5, targets: ['Treatment'] },
  { id: 'zenodo_neospectra_soil_nir_ccby', features: 601, targets: [
    'oc_usda_c729_w_pct', 'c_tot_usda_a622_w_pct', 'n_tot_usda_a623_w_pct',
    'clay_tot_usda_a334_w_pct', 'sand_tot_usda_c60_w_pct', 'silt_tot_usda_c62_w_pct',
    'bd_usda_a4_g_cm3', 'ph_h2o_usda_a268_index', 'caco3_usda_a54_w_pct', 'k_ext_usda_a725_cmolc_kg',
  ] },
];

function fixture(profile, run) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-public-readback-'));
  try {
    const directory = path.join(workspace, 'imports', 'public');
    fs.mkdirSync(directory, { recursive: true });
    const dataset = { path: directory, config: { public_dataset: {
      dataset_id: profile.id, source_id: 'X', requested_source_id: 'X',
    }, target_selection: { selected_targets: [...profile.targets] } } };
    const provenance = { provider: 'nirs4all-datasets', provider_version: selectedOwner.version,
      tier: 'public', dataset_id: profile.id, source_id: 'X',
      rows: 3, declared_targets: [...profile.targets], join_key: 'sample_id' };
    const axis = Array.from({ length: profile.features }, (_, index) => profile.features === 601 ? 1350 + index * 2 : index);
    const mean = Array.from({ length: profile.features }, (_, index) => index + 1);
    const preview = { success: true, summary: { num_samples: 3, num_features: profile.features },
      spectra_preview: { wavelengths: axis, mean_spectrum: mean } };
    return run({ workspace, dataset, provenance, preview });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

for (const profile of profiles) {
  test(`${profile.id}: readback retains the explicit owner identity, rows, axis and every target`, () => {
    fixture(profile, ({ dataset, provenance, preview, workspace }) => {
      assert.deepEqual(verifyReadback(dataset, provenance, preview, workspace, profile.id), {
        samples: 3, features: profile.features, axis: preview.spectra_preview.wavelengths,
        mean_spectrum: preview.spectra_preview.mean_spectrum,
        targets: profile.targets, join_key: 'sample_id',
      });
    });
  });

  for (const [name, change] of [
    ['a different dataset', value => { value.dataset.config.public_dataset.dataset_id = 'other'; }],
    ['a different source', value => { value.dataset.config.public_dataset.source_id = 'other'; }],
    ['an incomplete readback', value => { value.preview.summary.num_samples = 2; }],
    ['a different feature layout', value => { value.preview.summary.num_features -= 1; }],
    ['a truncated axis', value => { value.preview.spectra_preview.wavelengths.pop(); }],
    ['a truncated spectrum', value => { value.preview.spectra_preview.mean_spectrum.pop(); }],
    ['lost target selections', value => { value.dataset.config.target_selection.selected_targets = []; }],
    ['a target lost from both provenance and selection', value => {
      value.provenance.declared_targets.pop(); value.dataset.config.target_selection.selected_targets.pop();
    }],
    ['a path outside the owned workspace', value => { value.dataset.path = path.dirname(value.workspace); }],
    ['the workspace root as an imported dataset', value => { value.dataset.path = value.workspace; }],
  ]) {
    test(`${profile.id}: readback refuses ${name}`, () => {
      fixture(profile, value => {
        change(value);
        assert.throws(() => verifyReadback(value.dataset, value.provenance, value.preview, value.workspace, profile.id));
      });
    });
  }
}

test('an unknown or omitted smoke fixture is refused rather than selecting another dataset', () => {
  fixture(profiles[0], ({ dataset, provenance, preview, workspace }) => {
    for (const id of [undefined, 'unknown', '__proto__']) {
      assert.throws(() => verifyReadback(dataset, provenance, preview, workspace, id), /explicit declared/);
    }
  });
});

test('an early response timeout remains an ordinary smoke failure while its action is pending', () => {
  const legacy = `
    (async () => {
      const response = new Promise((_, reject) => setTimeout(() => reject(new Error('preview-response-timeout')), 5));
      await new Promise(resolve => setTimeout(resolve, 50));
      await response;
    })().catch(() => { process.stdout.write('caught'); });
  `;
  const old = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', legacy], { encoding: 'utf8', timeout: 5000 });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /preview-response-timeout/);
  assert.equal(old.stdout, '');

  const owned = `
    const { responseForAction } = require(${JSON.stringify(require.resolve('../smoke-public-dataset-journey.cjs'))});
    const page = { waitForResponse: () => new Promise((_, reject) => setTimeout(() => reject(new Error('preview-response-timeout')), 5)) };
    responseForAction(page, () => true, () => new Promise(resolve => setTimeout(resolve, 50)))
      .catch(error => { process.stdout.write(error.message); });
  `;
  const current = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', owned], { encoding: 'utf8', timeout: 5000 });
  assert.equal(current.status, 0, current.stderr);
  assert.equal(current.stdout, 'preview-response-timeout');
  assert.equal(current.stderr, '');
});

test('response/action pairing keeps the exact response and propagates action failures', async () => {
  const expected = { status: 200 };
  let calls = 0;
  const page = { waitForResponse: predicate => {
    assert.equal(predicate(expected), true);
    return Promise.resolve(expected);
  } };
  assert.equal(await responseForAction(page, response => response.status === 200, () => { calls += 1; }), expected);
  assert.equal(calls, 1);
  const failure = new Error('heading could not be clicked');
  await assert.rejects(responseForAction(page, () => true, () => { throw failure; }), error => error === failure);
});

test('a failed journey retains its phase, redacted API transport and screenshot without replacing the error', async () => {
  const page = new EventEmitter();
  const failure = new Error('navigation failed');
  const image = Buffer.from('synthetic PNG fixture');
  page.evaluate = async () => {
    page.emit('response', { request: () => ({ method: () => 'GET' }), status: () => 503,
      url: () => 'http://user:password@127.0.0.1:2345/api/datasets/public?token=private' });
    page.emit('requestfailed', { method: () => 'GET', failure: () => ({ errorText: 'connection refused' }),
      url: () => 'http://127.0.0.1:2345/api/datasets/example/preview?token=private' });
    throw failure;
  };
  page.url = () => 'file:///studio/index.html#/datasets';
  page.locator = selector => {
    assert.equal(selector, 'body');
    return { innerText: async () => 'Public datasets: authorization=secret-value' };
  };
  page.screenshot = async options => { assert.equal(options.timeout, 1000); return image; };
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-public-diagnostics-'));
  const proof = {};
  try {
    await assert.rejects(publicDatasetJourney({ page, env: {} }, proof, workspace, profiles[0].id), error => error === failure);
    assert.equal(proof.public_dataset.success, false);
    assert.equal(proof.public_dataset.phase, 'open-datasets');
    assert.deepEqual(proof.public_dataset.transport, [
      { kind: 'response', method: 'GET', status: 503, url: 'http://127.0.0.1:2345/api/datasets/public' },
      { kind: 'request-failed', method: 'GET', error: 'connection refused', url: 'http://127.0.0.1:2345/api/datasets/example/preview' },
    ]);
    assert.equal(proof.public_dataset.page_url, 'file:///studio/index.html');
    assert.doesNotMatch(proof.public_dataset.body_text, /secret-value/);
    assert.deepEqual(Buffer.from(proof.public_dataset.screenshot_png_base64, 'base64'), image);
    assert.equal(page.listenerCount('response'), 0);
    assert.equal(page.listenerCount('requestfailed'), 0);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
