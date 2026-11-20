const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyReadback } = require('../smoke-public-dataset-journey.cjs');
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
