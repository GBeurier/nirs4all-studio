/** Exercise the installed SHAP page against a real captured predictor and jobs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');

async function api(env, route, body) {
  const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_NATIVE_SIDECAR_PORT}/api${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Nirs4all-Session': env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120000),
  });
  assert(response.ok, `SHAP journey ${route}: HTTP ${response.status}`);
  return response.json();
}

async function waitForJob(env, route) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const job = await api(env, route);
    if (job.status === 'completed') return job;
    assert(!['failed', 'error', 'cancelled'].includes(job.status), `SHAP journey job failed: ${job.error || job.message || job.status}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('SHAP journey job did not finish within two minutes');
}

async function shapJourney({ page, env }, proof, workspace) {
  // The renderer and workspace can be ready before the asynchronous ML host.
  const deadline = Date.now() + 120000;
  while (true) {
    const readiness = await api(env, '/system/readiness');
    if (readiness.ml_ready) break;
    assert(readiness.ml_loading, 'The scientific host failed to initialize');
    assert(Date.now() < deadline, 'The scientific host did not initialize within two minutes');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const directory = path.join(workspace, 'shap-smoke-data');
  fs.mkdirSync(directory);
  for (const [partition, start, count] of [['cal', 0, 24], ['val', 24, 8]]) {
    const spectra = ['1000;1100;1200;1300'];
    const targets = ['target'];
    for (let index = start; index < start + count; index += 1) {
      const row = [index / 7, Math.sin(index), Math.cos(index / 3), (index % 5) / 2];
      spectra.push(row.join(';'));
      targets.push(String(2 * row[0] - row[1] + 0.4 * row[2] + row[3]));
    }
    fs.writeFileSync(path.join(directory, `X${partition}.csv`), spectra.join('\n') + '\n');
    fs.writeFileSync(path.join(directory, `Y${partition}.csv`), targets.join('\n') + '\n');
  }
  const linked = await api(env, '/datasets/link', { path: directory, config: {
    delimiter: ';', has_header: true,
    files: ['cal', 'val'].flatMap(partition => ['X', 'Y'].map(type => ({
      path: `${type}${partition}.csv`, type, split: partition === 'cal' ? 'train' : 'test',
    }))),
  } });
  const dataset = linked.dataset.id;
  const imported = await api(env, '/pipelines/import', { payload: { name: 'SHAP smoke Ridge', pipeline: [
    { class: 'sklearn.preprocessing.StandardScaler' },
    { class: 'sklearn.model_selection.KFold', params: { n_splits: 3 } },
    { class: 'sklearn.linear_model.Ridge', params: { alpha: 0.1 } },
  ] } });
  const pipeline = imported.pipeline.id;
  const pair = `${dataset}::${pipeline}`;
  const name = 'Installed SHAP smoke';
  const submitted = await api(env, '/runs/run-groups', {
    legacyConfig: { name, dataset_ids: [dataset], pipeline_ids: [pipeline], execution_backend: 'local-python', engine: 'dag-ml', allow_fallback: false },
    manifest: { version: 'studio.native-launch-payload.v1', legacyExperimentName: name, legacyDatasetCount: 1,
      legacyPipelineCount: 1, strictCampaignCount: 1, skippedRunCount: 0, sourceRunIds: [pair], skippedRunIds: [] },
    strictCampaignSpecs: { splitSpecs: [{ id: `single-pair:${pair}`, sourceRunId: pair, sourceDatasetId: dataset,
      sourcePipelineId: pipeline, campaign: { name, mode: 'paired_by_index', executionBackend: 'local-python',
        datasets: [{ id: dataset, name: 'SHAP fixture', splitGroupBy: null }],
        pipelines: [{ id: pipeline, name: 'SHAP smoke Ridge', source: 'saved' }],
        runMatrix: [{ id: pair, datasetId: dataset, pipelineId: pipeline, datasetIndex: 0, pipelineIndex: 0, splitGroupBy: null }] } }], skippedRunIds: [] },
  });
  await waitForJob(env, `/training/${submitted.job_id || submitted.run_id}`);
  const models = await api(env, '/analysis/shap/models');
  const chain = models.datasets.flatMap(group => group.chains).find(model => model.linked_dataset_id === dataset);
  assert(chain && chain.has_refit, 'SHAP journey requires the actual fitted predictor and its authorized dataset link');

  let blockedSockets = 0;
  await page.routeWebSocket(/\/ws\/job\//, socket => { blockedSockets += 1; socket.close(); });
  await page.evaluate(({ chainId, datasetName }) => {
    sessionStorage.setItem('nirs4all_shap_session', JSON.stringify({ version: 1, savedAt: Date.now(),
      chainId, datasetName, partition: 'test', explainerType: 'kernel', jobId: null,
      results: null, rebinnedData: null, isSubmitting: true, activeTab: 'spectral', selectedSamples: [] }));
    location.hash = '/lab/shapley';
  }, { chainId: chain.chain_id, datasetName: chain.dataset_name });
  await page.reload();
  const compute = page.getByRole('button', { name: 'Compute Explanations', exact: true });
  await expect(compute).toBeEnabled({ timeout: 30000 });
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/analysis/shap/compute') && response.request().method() === 'POST');
  await compute.click();
  const response = await responsePromise;
  assert(response.ok(), `Installed SHAP submission returned HTTP ${response.status()}`);
  const receipt = await response.json();
  await waitForJob(env, `/analysis/shap/status/${receipt.job_id}`);
  await expect(page.getByText('SHAP Analysis Results', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(compute).toBeEnabled();
  assert(blockedSockets > 0, 'The installed SHAP regression must run with its job WebSocket blocked');
  const result = await api(env, `/analysis/shap/results/${receipt.job_id}`);
  assert.equal(result.n_samples, 8);
  assert.equal(result.n_features, 4);
  assert(result.mean_abs_shap.every(Number.isFinite));
  const scatter = await api(env, `/analysis/shap/results/${receipt.job_id}/scatter`);
  const sample = await api(env, `/analysis/shap/results/${receipt.job_id}/sample/0?top_n=4`);
  const additive = sample.base_value + sample.contributions.reduce((sum, item) => sum + item.shap_value, 0);
  assert(Math.abs(additive - scatter.y_pred[0]) < 1e-5, 'SHAP contributions must explain the captured prediction');
  await page.reload();
  await expect(page.getByText('SHAP Analysis Results', { exact: true })).toBeVisible({ timeout: 30000 });
  proof.shap = { success: true, job_id: receipt.job_id, samples: result.n_samples, features: result.n_features,
    blocked_job_websockets: blockedSockets, restored_results: true, captured_prediction_additivity: true };
  console.log('PACKAGED_SHAP_OK captured predictor, missed WebSocket events, interrupted submission and restored results');
}

module.exports = { api, waitForJob, shapJourney };
