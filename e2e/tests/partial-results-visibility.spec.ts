import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('successful model remains visible in Leaderboard and Database after a later model fails', async ({ page, request }, testInfo) => {
  const api = process.env.PLAYWRIGHT_API_BASE_URL;
  const root = process.env.RECOVERY_E2E_ROOT;
  test.skip(!api || !root, 'Run with playwright.recovery.config.ts to protect existing workspaces');
  const data = join(root!, 'retained-ridge');
  mkdirSync(data, { recursive: true });
  const files = [];
  for (const split of ['train', 'test']) {
    const offset = split === 'train' ? 0 : 36;
    const rows = Array.from({ length: split === 'train' ? 36 : 12 }, (_, index) =>
      Array.from({ length: 8 }, (_, feature) => Math.sin((offset + index + 1) * (feature + 1) * 0.17) + feature));
    for (const kind of ['X', 'Y']) {
      const path = join(data, `${kind}${split}.csv`);
      const values = kind === 'X' ? rows : rows.map(row => [row[0] * 2 - row[1] * 0.7 + row[3] * 0.2]);
      writeFileSync(path, `${kind === 'X' ? rows[0].map((_, i) => 1000 + i * 10).join(';') : 'target'}\n${values.map(row => row.join(';')).join('\n')}\n`);
      files.push({ path, type: kind, split });
    }
  }
  const linked = await request.post(`${api}/api/datasets/link`, { data: {
    path: data, config: { files, delimiter: ';', has_header: true, task_type: 'regression' },
  } });
  expect(linked.ok(), await linked.text()).toBeTruthy();
  const { dataset } = await linked.json();
  const created = await request.post(`${api}/api/runs/quick`, { data: {
    pipeline_id: 'partial-visibility', dataset_id: dataset.id, name: 'Successful Ridge then invalid PLS', engine: 'legacy',
    inline_pipeline: { name: 'Successful Ridge then invalid PLS', steps: [
      { id: 'scale', type: 'preprocessing', name: 'StandardScaler', classPath: 'sklearn.preprocessing.StandardScaler', params: {} },
      { id: 'folds', type: 'splitting', name: 'KFold', classPath: 'sklearn.model_selection.KFold', params: { n_splits: 2 } },
      { id: 'ridge', type: 'model', name: 'Ridge', classPath: 'sklearn.linear_model.Ridge', params: { alpha: 1 } },
      { id: 'invalid', type: 'model', name: 'PLSRegression', classPath: 'sklearn.cross_decomposition.PLSRegression', params: { n_components: 10000 } },
    ] },
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const started = await created.json();
  let finished: { status: string; [key: string]: unknown };
  await expect.poll(async () => {
    finished = await (await request.get(`${api}/api/runs/${started.id}`)).json();
    return finished.status;
  }, { timeout: 60000, intervals: [250, 500, 1000] }).toMatch(/^(failed|partial)$/);
  const runProof = testInfo.outputPath('real-failed-run.json');
  writeFileSync(runProof, JSON.stringify(finished!, null, 2));
  await testInfo.attach('real-failed-run', { path: runProof, contentType: 'application/json' });
  const workspaces = await (await request.get(`${api}/api/workspaces`)).json();
  const summary = await (await request.get(`${api}/api/workspaces/${workspaces.active_workspace_id}/results/summary`)).json();
  const chain = summary.datasets.find((item: { dataset_name: string }) => item.dataset_name === 'retained-ridge').top_chains[0];
  expect(chain.model_name).toBe('Ridge');
  expect(Number.isFinite(chain.avg_val_score)).toBe(true);
  expect(chain.avg_val_score).toBeGreaterThan(0);
  const expectedScore = chain.avg_val_score.toFixed(3);
  const scoresProof = testInfo.outputPath('real-stored-scores.json');
  writeFileSync(scoresProof, JSON.stringify(summary, null, 2));
  await testInfo.attach('real-stored-scores', { path: scoresProof, contentType: 'application/json' });

  await page.addInitScript(() => localStorage.setItem('nirs4all-telemetry-consent', 'declined'));
  // The dedicated Vite proxy forwards to the real backend. No response interception.
  try {
    await page.goto('/results');
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
    await expect(page.getByText('Ridge', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('retained-ridge', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(expectedScore, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Loading workspace...', { exact: true })).not.toBeVisible({ timeout: 10000 });
    const leaderboardProof = testInfo.outputPath('leaderboard-retained-score.png');
    await page.screenshot({ path: leaderboardProof });
    await testInfo.attach('leaderboard-retained-score', { path: leaderboardProof, contentType: 'image/png' });
    await page.goto('/predictions');
    await expect(page.getByRole('heading', { name: 'Predictions', exact: true })).toBeVisible();
    await expect(page.getByText('Ridge', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(expectedScore, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Loading workspace...', { exact: true })).not.toBeVisible({ timeout: 10000 });
    const databaseProof = testInfo.outputPath('database-retained-score.png');
    await page.screenshot({ path: databaseProof });
    await testInfo.attach('database-retained-score', { path: databaseProof, contentType: 'image/png' });
    const ridgeRow = page.getByRole('row').filter({ hasText: 'Ridge' }).first();
    await ridgeRow.locator('button[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Chart view', exact: true }).click();
    const viewer = page.getByRole('dialog');
    await expect(viewer.locator('svg.recharts-surface').first()).toBeVisible();
    await viewer.getByText('View prediction values (first 20)', { exact: true }).click();
    await expect(viewer.locator('table tbody tr').first()).toBeVisible();
    expect(await viewer.locator('table tbody tr').count()).toBeGreaterThan(0);
    const chartProof = testInfo.outputPath('retained-prediction-chart.png');
    await page.screenshot({ path: chartProof });
    await testInfo.attach('retained-prediction-chart', { path: chartProof, contentType: 'image/png' });
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); }
});
