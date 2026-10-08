#!/usr/bin/env node
/** Exercise four-source import, native run, archive selection and replay in the installed UI. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expect } = require('@playwright/test');
const archive = require('./smoke-archive-standalone.cjs');
const ui = require('./smoke-first-launch-ui.cjs');
const { resolvePerformancePolicy, timed, functionalTimeout } = require('./qualification-performance.cjs');

const fixtures = path.join(__dirname, 'fixtures', 'multimodal-ui');

async function api(env, route, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_NATIVE_SIDECAR_PORT}/api${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Nirs4all-Session': env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, `${method} ${route} returned HTTP ${response.status}`);
  return response.json();
}

async function journey({ page, env }, workspace, proof) {
  const uiWait = (phase, assertion) => timed(proof, phase, 5000,
    () => assertion({ timeout: functionalTimeout(proof, 5000) }));
  await api(env, '/workspace/create', 'POST', {
    path: workspace, name: 'Multimodal package smoke', create_dir: true,
  });
  await api(env, '/workspace/select', 'POST', { path: workspace });
  await page.reload();
  await page.getByRole('link', { name: 'Datasets', exact: true }).click();

  await page.getByRole('button', { name: 'Import multimodal', exact: true }).click();
  const cohortDialog = page.getByRole('dialog', { name: 'Import multimodal dataset' });
  await cohortDialog.locator('#multimodal-descriptor-file').setInputFiles(path.join(fixtures, 'cohort.json'));
  await cohortDialog.locator('#multimodal-dataset-name').fill('UI multimodal fixture');
  await uiWait('multimodal_import_preview', options =>
    expect(cohortDialog.getByRole('status')).toContainText('16 samples', options));
  await cohortDialog.getByRole('button', { name: 'Import dataset' }).click();
  await uiWait('multimodal_import_completed', options => expect(cohortDialog).toBeHidden(options));
  await uiWait('multimodal_dataset_visible', options =>
    expect(page.getByText('UI multimodal fixture', { exact: true }).first()).toBeVisible(options));

  await page.getByRole('link', { name: 'Pipelines', exact: true }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const pipelineDialog = page.getByRole('dialog', { name: 'Import Pipeline' });
  await pipelineDialog.locator('#pipeline-json').fill(fs.readFileSync(path.join(fixtures, 'pipeline.json'), 'utf8'));
  await pipelineDialog.getByRole('button', { name: 'Import Pipeline' }).click();
  await uiWait('multimodal_pipeline_import_completed', options => expect(pipelineDialog).toBeHidden(options));
  await uiWait('multimodal_pipeline_visible', options =>
    expect(page.getByText('Four modality fixed (Imported)', { exact: true }).first()).toBeVisible(options));

  await page.getByRole('link', { name: 'Run', exact: true }).click();
  await uiWait('multimodal_experiment_visible', options =>
    expect(page.getByRole('heading', { name: 'New Experiment' })).toBeVisible(options));
  await page.locator('[data-experiment-pipeline-id]').filter({ hasText: 'Four modality fixed' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.locator('[data-experiment-dataset-id]').filter({ hasText: 'UI multimodal fixture' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await uiWait('multimodal_groups_visible', options => expect(page.getByText('Using cohort groups')).toBeVisible(options));
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await uiWait('multimodal_native_api_visible', options => expect(page.getByText('Native local run API')).toBeVisible(options));
  await page.getByRole('button', { name: 'Submit Native Payload' }).click();
  await expect.poll(async () => (await api(env, '/runs')).runs?.[0]?.status,
    { timeout: 180000, intervals: [1000, 2000, 3000] }).toBe('completed');
  // The renderer refreshes its run list every 10 seconds after the API reports completion.
  await expect(page.getByText('UI multimodal fixture x Four modality fixed', { exact: false }).first())
    .toBeVisible({ timeout: 30000 });
  assert(fs.readdirSync(path.join(workspace, 'exports')).some(name => name.endsWith('.n4a')),
    'The installed UI run did not export a multimodal archive');

  await page.getByRole('link', { name: 'Predict', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh models' }).click();
  const multimodalModel = page.locator('#general-model option').filter({ hasText: 'multimodal' });
  await expect(multimodalModel).toHaveCount(1, { timeout: 30000 });
  const modelValue = await multimodalModel.getAttribute('value');
  assert(modelValue, 'The captured multimodal model has no selector value');
  await page.locator('#general-model').selectOption(modelValue);
  await page.getByRole('tab', { name: 'Dataset', exact: true }).click();
  await uiWait('multimodal_linked_dataset_visible', options =>
    expect(page.getByText('1 linked multimodal dataset available.')).toBeVisible(options));
  await page.getByText('1 linked multimodal dataset available.').locator('..').getByRole('combobox').click();
  await page.getByRole('option', { name: 'UI multimodal fixture' }).click();
  await page.getByRole('button', { name: 'Run Prediction' }).click();
  await expect(page.getByRole('status').filter({ hasText: '4 predictions' }))
    .toContainText('captured REFIT, no training', { timeout: 120000 });
  assert.equal((await api(env, '/runs')).runs?.[0]?.status, 'completed');
  console.log('PACKAGED_MULTIMODAL_UI_OK import run archive replay 4 predictions no fit');
}

async function main(installedConfig, suppliedProof, inspectProfile) {
  const config = installedConfig || archive.assertValidConfig(archive.parseArgs());
  const proof = suppliedProof || { timings: [], performance_policy: resolvePerformancePolicy() };
  const sandbox = config.sandboxRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'studio-multimodal-ui-'));
  let passed = false;
  try {
    await ui.main({
      config,
      sandboxRoot: sandbox,
      consent: 'decline',
      timings: proof.timings,
      performancePolicy: proof.performance_policy,
      inspectProfile,
      journeys: context => journey(context, path.join(sandbox, 'workspace'), proof),
    });
    passed = true;
    return proof;
  } finally {
    if (passed && !config.sandboxRoot) await archive.cleanupSandboxRoot(sandbox);
    else if (!passed) console.error(`Multimodal UI smoke profile retained: ${sandbox}`);
  }
}

if (require.main === module) main().catch(error => {
  console.error('Multimodal UI smoke failed:', ui.sanitizeDiagnostic(error.stack || error));
  process.exitCode = 1;
});

module.exports = { main };
