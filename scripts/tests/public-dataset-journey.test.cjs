const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyReadback } = require('../smoke-public-dataset-journey.cjs');
const { datasets: selectedOwner } = require('../../build/runtime-cohort.json');

function fixture(run) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-public-readback-'));
  try {
    const directory = path.join(workspace, 'imports', 'public');
    fs.mkdirSync(directory, { recursive: true });
    const dataset = { path: directory, config: { public_dataset: {
      dataset_id: 'canopy_treatment_2009_2016_to_cedar_ecosis', source_id: 'X', requested_source_id: 'X',
    }, target_selection: { selected_targets: ['target'] } } };
    const provenance = { provider: 'nirs4all-datasets', provider_version: selectedOwner.version,
      tier: 'public', dataset_id: dataset.config.public_dataset.dataset_id, source_id: 'X',
      rows: 3, declared_targets: ['target'], join_key: 'sample_id' };
    const preview = { success: true, summary: { num_samples: 3, num_features: 5 },
      spectra_preview: { wavelengths: [0, 1, 2, 3, 4], mean_spectrum: [1, 2, 3, 4, 5] } };
    return run({ workspace, dataset, provenance, preview });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

test('readback retains the registered public identity, source, row count, axis and target selection', () => {
  fixture(({ dataset, provenance, preview, workspace }) => {
    assert.deepEqual(verifyReadback(dataset, provenance, preview, workspace), {
      samples: 3, features: 5, axis: [0, 1, 2, 3, 4], mean_spectrum: [1, 2, 3, 4, 5],
      targets: ['target'], join_key: 'sample_id',
    });
  });
});

for (const [name, change] of [
  ['a different source', value => { value.dataset.config.public_dataset.source_id = 'other'; }],
  ['an incomplete readback', value => { value.preview.summary.num_samples = 2; }],
  ['a different feature layout', value => { value.preview.summary.num_features = 4; }],
  ['lost target selections', value => { value.dataset.config.target_selection.selected_targets = []; }],
]) {
  test(`readback refuses ${name}`, () => {
    fixture(value => { change(value); assert.throws(() => verifyReadback(value.dataset, value.provenance, value.preview, value.workspace)); });
  });
}
