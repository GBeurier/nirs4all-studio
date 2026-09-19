/** Real renderer import/SNV/Predictions and native run-group training qualification. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { expect } = require('@playwright/test');
const BUDGETS = Object.freeze({ preview: 5000, link: 5000, playground: 10000, training: 60000, predictions: 5000 });
async function timed(proof, phase, budget, callback) {
  const start = performance.now();
  const result = await callback();
  const duration_ms = performance.now() - start;
  proof.timings.push({ phase, duration_ms, budget_ms: budget });
  assert(duration_ms <= budget, `${phase} took ${Math.round(duration_ms)}ms; budget ${budget}ms`);
  return result;
}
async function api(env, route, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_NATIVE_SIDECAR_PORT}/api${route}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Nirs4all-Session': env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, `${method} ${route}: HTTP ${response.status}: ${!response.ok ? await response.text() : ''}`);
  return response.json();
}
async function businessJourney(context, data) {
  const { page, app, env, proof } = context;
  await page.getByRole('link', { name: 'Datasets', exact: true }).click();
  // The OS file chooser is the only replacement; all app processing remains real.
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, data);
  await page.getByRole('button', { name: /add dataset/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Select Folder', { exact: true }).click();
  await dialog.getByPlaceholder('Enter dataset name').fill('Release journey spectra');
  for (const description of ['Configure file roles and splits', 'Configure CSV and data parsing', 'Configure target columns and task type']) {
    await expect(dialog.getByText(description, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await timed(proof, 'dataset_preview_ui', BUDGETS.preview, async () => {
    try { await expect(dialog.getByText(/All files parsed successfully/)).toBeVisible({ timeout: BUDGETS.preview }); }
    catch (error) { throw new Error(`${error.message}\nDataset wizard:\n${await dialog.innerText()}\nRequests:\n${JSON.stringify(context.requests)}`); }
  });
  await timed(proof, 'dataset_link_ui', BUDGETS.link, async () => {
    await dialog.getByRole('button', { name: 'Add Dataset', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: BUDGETS.link });
    await expect(page.getByText('Release journey spectra', { exact: true }).first()).toBeVisible({ timeout: BUDGETS.link });
  });
  const dataset = (await api(env, '/datasets')).datasets.find(entry => entry.name === 'Release journey spectra');
  assert(dataset && dataset.num_samples === 1000, `Wrong imported dataset: ${JSON.stringify(dataset)}`);
  proof.dataset = { id: dataset.id, samples: dataset.num_samples, features: dataset.num_features };
  const inspector = await page.context().newCDPSession(page);
  await inspector.send('Network.enable', { maxResourceBufferSize: 64 * 1024 * 1024, maxTotalBufferSize: 128 * 1024 * 1024 });
  await timed(proof, 'playground_transform_ui', BUDGETS.playground, async () => {
    await page.evaluate(({ id, name }) => { window.location.hash = `/playground?datasetId=${encodeURIComponent(id)}&datasetName=${encodeURIComponent(name)}`; }, dataset);
    await page.getByRole('button', { name: /Search operators/ }).click();
    await page.getByPlaceholder('Search operators...').fill('SNV');
    const responsePromise = page.waitForResponse(response => response.url().includes('/playground/execute')
      && response.request().method() === 'POST'
      && response.request().postDataJSON()?.steps?.some(step => /StandardNormalVariate|SNV/.test(step.name)), { timeout: BUDGETS.playground });
    await page.getByRole('option').filter({ has: page.getByText(/^(SNV|Standard Normal Variate|StandardNormalVariate)$/) }).first().click();
    const response = await responsePromise;
    const payload = await response.body();
    const result = response.headers()['content-type']?.includes('application/x-msgpack')
      ? require('@msgpack/msgpack').decode(payload) : JSON.parse(payload.toString('utf8'));
    assert(result.success && !result.is_raw_data && result.execution_trace.some(step => step.success && /StandardNormalVariate|SNV/.test(step.name)),
      `Renderer did not execute SNV: ${JSON.stringify({ trace: result.execution_trace, errors: result.step_errors })}`);
    assert(result.processed && result.original, 'Missing real spectral arrays');
    const spectrum = result.processed.spectra[0];
    assert(Array.isArray(spectrum) && spectrum.length === dataset.num_features && spectrum.every(Number.isFinite));
    const mean = spectrum.reduce((sum, value) => sum + value, 0) / spectrum.length;
    const variance = spectrum.reduce((sum, value) => sum + (value - mean) ** 2, 0) / spectrum.length;
    assert(Math.abs(mean) < 1e-5 && Math.abs(variance - 1) < .02, `SNV numerical invariant failed: mean=${mean}, variance=${variance}, trace=${JSON.stringify(result.execution_trace)}`);
    proof.playground = { response_bytes: payload.length, execution_time_ms: result.execution_time_ms, trace: result.execution_trace };
    await expect(page.locator('canvas, .recharts-surface').first()).toBeVisible({ timeout: BUDGETS.playground });
  });
  await inspector.detach();
  if (context.profile) await page.screenshot({ path: path.join(context.profile, 'playground.png') });
  const training = await timed(proof, 'pls_training', BUDGETS.training, async () => {
    const pipeline = (await api(env, '/pipelines', 'POST', { name: 'Release PLS', taskType: 'regression', steps: [
      { id: 'scale', type: 'preprocessing', name: 'StandardScaler', params: {} },
      { id: 'folds', type: 'splitting', name: 'KFold', params: { n_splits: 3, shuffle: true, random_state: 42 } },
      { id: 'pls', type: 'model', name: 'PLSRegression', params: { n_components: 3 } },
    ] })).pipeline;
    assert(pipeline?.id, 'Pipeline save failed');
    const runId = `${dataset.id}::${pipeline.id}`;
    const name = 'Release PLS qualification';
    const payload = {
      legacyConfig: { name, dataset_ids: [dataset.id], pipeline_ids: [pipeline.id], execution_backend: 'local-python', engine: 'dag-ml', allow_fallback: false, split_group_by_by_dataset: {} },
      manifest: { version: 'studio.native-launch-payload.v1', legacyExperimentName: name, legacyDatasetCount: 1, legacyPipelineCount: 1, strictCampaignCount: 1, skippedRunCount: 0, sourceRunIds: [runId], skippedRunIds: [] },
      strictCampaignSpecs: { splitSpecs: [{ id: `single-pair:${runId}`, sourceRunId: runId, sourceDatasetId: dataset.id, sourcePipelineId: pipeline.id,
        campaign: { name, mode: 'paired_by_index', executionBackend: 'local-python', datasets: [{ id: dataset.id, name: dataset.name, splitGroupBy: null }],
          pipelines: [{ id: pipeline.id, name: pipeline.name, source: 'saved' }],
          runMatrix: [{ id: runId, datasetId: dataset.id, pipelineId: pipeline.id, datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null }] } }], skippedRunIds: [] },
    };
    const decision = await page.evaluate(() => window.electronApi.preselectRendererTransport({ kind: 'http', method: 'POST', path: '/runs/run-groups' }));
    assert.equal(decision.target, 'native-sidecar', JSON.stringify(decision));
    const started = await api(env, '/runs/run-groups', 'POST', payload);
    assert(started.job_id, JSON.stringify(started));
    let result;
    await expect.poll(async () => {
      result = await api(env, `/training/${started.job_id}`);
      assert(!['failed', 'error', 'cancelled'].includes(result.status), JSON.stringify(result));
      return result.status;
    }, { timeout: BUDGETS.training, intervals: [200, 500, 1000] }).toBe('completed');
    return result;
  });
  proof.training = { id: training.id || training.job_id, status: training.status, requested_engine: 'dag-ml', fallback: false };

  await timed(proof, 'nonempty_predictions_ui', BUDGETS.predictions, async () => {
    const stored = await api(env, '/aggregated-predictions');
    assert(stored.total > 0 && stored.predictions.some(entry => Number.isFinite(entry.cv_val_score)), 'No finite cross-validation prediction score');
    proof.predictions = { total: stored.total, cv_val_scores: stored.predictions.map(entry => entry.cv_val_score) };
    const cvChain = stored.predictions.find(entry => Number.isFinite(entry.cv_val_score));
    const chain = await api(env, `/aggregated-predictions/chain/${encodeURIComponent(cvChain.chain_id)}`);
    const fold = chain.predictions.find(entry => entry.partition === 'val');
    assert(fold?.prediction_id, 'No persisted validation-fold predictions');
    const arrays = await api(env, `/aggregated-predictions/${encodeURIComponent(fold.prediction_id)}/arrays`);
    const truth = arrays.y_true?.flat(Infinity), predicted = arrays.y_pred?.flat(Infinity);
    assert(truth?.length > 100 && truth.length === predicted?.length && truth.every(Number.isFinite) && predicted.every(Number.isFinite));
    proof.predictions.validation_samples = truth.length;
    await page.locator('a[href="#/predictions"]').click();
    await expect(page.getByText('PLSRegression', { exact: false }).first()).toBeVisible({ timeout: BUDGETS.predictions });
    await expect(page.getByText(/Error loading predictions|route_not_native_qualified|No predictions/i)).not.toBeVisible();
  });
  if (context.profile) await page.screenshot({ path: path.join(context.profile, 'predictions.png') });
  if (context.errors) assert.deepEqual(context.errors, []);
  return dataset;
}

module.exports = { businessJourney };
