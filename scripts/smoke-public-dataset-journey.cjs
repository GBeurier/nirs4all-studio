/** Exercise the public button, original-source acquisition and registered data preview. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');
const { api, waitForJob } = require('./smoke-shap-journey.cjs');
const { contained } = require('./smoke-owned-profile.cjs');
const { datasets: selectedOwner } = require('../build/runtime-cohort.json');

// External-network fixtures are declared choices, never an automatic fallback
// when an origin fails. These identities and targets come from the owner catalogue.
const PUBLIC_DATASETS = Object.freeze({
  canopy_treatment_2009_2016_to_cedar_ecosis: Object.freeze({
    sourceId: 'X', features: 5, targets: Object.freeze(['Treatment']),
  }),
  zenodo_neospectra_soil_nir_ccby: Object.freeze({
    sourceId: 'X', features: 601, targets: Object.freeze([
      'oc_usda_c729_w_pct', 'c_tot_usda_a622_w_pct', 'n_tot_usda_a623_w_pct',
      'clay_tot_usda_a334_w_pct', 'sand_tot_usda_c60_w_pct', 'silt_tot_usda_c62_w_pct',
      'bd_usda_a4_g_cm3', 'ph_h2o_usda_a268_index', 'caco3_usda_a54_w_pct', 'k_ext_usda_a725_cmolc_kg',
    ]),
  }),
});

function selectedDataset(datasetId) {
  assert(Object.hasOwn(PUBLIC_DATASETS, datasetId), 'Choose an explicit declared public-dataset smoke fixture');
  return PUBLIC_DATASETS[datasetId];
}

function verifyReadback(dataset, provenance, preview, workspace, datasetId) {
  const selected = selectedDataset(datasetId);
  contained(workspace, dataset.path);
  assert.deepEqual(dataset.config.public_dataset, {
    dataset_id: datasetId, source_id: selected.sourceId, requested_source_id: selected.sourceId,
  });
  assert.equal(provenance.provider, 'nirs4all-datasets');
  assert.equal(provenance.provider_version, selectedOwner.version);
  assert.equal(provenance.tier, 'public');
  assert.equal(provenance.dataset_id, datasetId);
  assert.equal(provenance.source_id, selected.sourceId);
  assert(provenance.rows > 0);
  assert.deepEqual(provenance.declared_targets, selected.targets);
  assert.deepEqual(dataset.config.target_selection?.selected_targets ?? [], provenance.declared_targets);
  assert.equal(preview.success, true, preview.error);
  assert.equal(preview.summary.num_samples, provenance.rows);
  assert.equal(preview.summary.num_features, selected.features);
  assert.equal(preview.spectra_preview.wavelengths.length, selected.features);
  assert.equal(preview.spectra_preview.mean_spectrum.length, selected.features);
  return { samples: preview.summary.num_samples, features: preview.summary.num_features,
    mean_spectrum: preview.spectra_preview.mean_spectrum, axis: preview.spectra_preview.wavelengths,
    targets: provenance.declared_targets, join_key: provenance.join_key };
}

async function publicDatasetJourney({ page, env }, proof, workspace, datasetId) {
  const selected = selectedDataset(datasetId);
  proof.public_dataset = { success: false, dataset_id: datasetId, source_id: selected.sourceId };
  const cache = path.join(workspace, '.nirs4all', 'cache', 'public-datasets');
  assert(!fs.existsSync(cache), 'The original-source journey requires a fresh owner cache');
  await page.evaluate(() => { location.hash = '/datasets'; });
  const catalogueResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/datasets/public' && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Public datasets', exact: true }).click();
  const response = await catalogueResponse;
  assert(response.ok(), `Public catalogue returned HTTP ${response.status()}`);
  const catalogue = await response.json();
  assert.equal(catalogue.version, selectedOwner.version);
  const entry = catalogue.datasets.find(dataset => dataset.id === datasetId);
  assert(entry && entry.source_ids.includes(selected.sourceId), 'The real public catalogue must expose the selected source');
  assert.equal(entry.n_features_total, selected.features);
  assert.equal(entry.n_targets, selected.targets.length);
  assert.deepEqual(entry.targets, selected.targets);
  const dialog = page.getByRole('dialog', { name: 'Public datasets', exact: true });
  await dialog.getByRole('textbox', { name: 'Search public datasets', exact: true }).fill(datasetId);
  await dialog.getByRole('listitem').filter({ hasText: datasetId }).getByRole('button').click();
  if (entry.n_sources > 1) await dialog.getByRole('radio', { name: selected.sourceId, exact: true }).check();
  const submittedResponse = page.waitForResponse(candidate =>
    new URL(candidate.url()).pathname === '/api/datasets/public/import' && candidate.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Download and add', exact: true }).click();
  const submitted = await submittedResponse;
  assert(submitted.ok(), `Public import returned HTTP ${submitted.status()}`);
  assert.deepEqual(submitted.request().postDataJSON(), { dataset_id: datasetId, source_id: selected.sourceId });
  const receipt = await submitted.json();
  assert(receipt.job_id, 'The renderer must submit a real Rust import job');
  const job = await waitForJob(env, `/datasets/public/imports/${encodeURIComponent(receipt.job_id)}`);
  assert.equal(job.result?.success, true);
  assert.equal(job.result.already_imported, false, 'A fresh journey must acquire the original public source');
  const dataset = job.result.dataset;
  await expect(dialog.getByRole('status').filter({ hasText: 'Added' })).toBeVisible({ timeout: 30000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const previewResponse = page.waitForResponse(candidate =>
    new URL(candidate.url()).pathname === `/api/datasets/${dataset.id}/preview` && candidate.request().method() === 'GET');
  await page.getByRole('heading', { level: 3, name: dataset.name, exact: true }).click();
  const previewed = await previewResponse;
  assert(previewed.ok(), `Registered dataset preview returned HTTP ${previewed.status()}`);
  const preview = await previewed.json();
  const provenance = JSON.parse(fs.readFileSync(path.join(dataset.path, 'provenance.json'), 'utf8'));
  const readback = verifyReadback(dataset, provenance, preview, workspace, datasetId);
  assert(fs.existsSync(cache), 'The owner must retain the source acquisition in its workspace cache');
  // Confirm durable registration survives a new renderer rather than only query-cache publication.
  await page.reload();
  await expect(page.getByRole('heading', { level: 3, name: dataset.name, exact: true })).toBeVisible({ timeout: 30000 });
  proof.public_dataset = { success: true, catalogue_version: catalogue.version, catalogue_count: catalogue.datasets.length,
    dataset_id: datasetId, source_id: selected.sourceId, linked_dataset_id: dataset.id, import_job_id: receipt.job_id,
    owner: provenance.provider, empty_workspace_cache_before_import: true, already_imported: false,
    registered_after_reload: true, preview_from_renderer: true, readback };
  console.log(`PACKAGED_PUBLIC_DATASET_OK ${datasetId}/${selected.sourceId}: ${readback.samples} samples, ${readback.features} features`);
}

module.exports = { publicDatasetJourney, verifyReadback };
