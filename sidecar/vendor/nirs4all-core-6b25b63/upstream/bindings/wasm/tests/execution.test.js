import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseExecutionPlan, predictPortablePipeline, runPortablePipeline } from '../src/index.js';
import { requireMethodsArtifact } from './methods-artifact.js';

const fixtureUrl = new URL('../../../tests/parity/fixtures/portable_methods_pipeline.json', import.meta.url);

function deterministicNoise(row, col) {
  let state = ((row + 1) * 73856093) ^ ((col + 1) * 19349663);
  state >>>= 0;
  state = (1664525 * state + 1013904223) >>> 0;
  return state / 4294967295 - 0.5;
}

function makeDataset(rows = 40, cols = 28) {
  const X = new Float64Array(rows * cols);
  const y = new Float64Array(rows);
  for (let r = 0; r < rows; r += 1) {
    const phase = r / 5;
    let target = 0;
    for (let c = 0; c < cols; c += 1) {
      const wavelength = 900 + c * 8;
      const value =
        0.6 * Math.sin(phase + c / 7)
        + 0.25 * Math.cos(r / 6 - c / 11)
        + 0.002 * wavelength
        + ((r % 4) - 1.5) * 0.03
        + 0.12 * deterministicNoise(r, c)
        + 0.03 * Math.sin(((r + 1) * (c + 2)) / 13);
      X[r * cols + c] = value;
      target += value * (c < cols / 2 ? 0.04 : -0.025) + 0.01 * deterministicNoise(c, r);
    }
    y[r] = target + 0.2 * Math.sin(r / 3) + r * 0.015;
  }
  return { X, y, rows, cols };
}

function maxAbsDiff(actual, expected) {
  assert.equal(actual.length, expected.length);
  let max = 0;
  for (let i = 0; i < actual.length; i += 1) {
    max = Math.max(max, Math.abs(actual[i] - expected[i]));
  }
  return max;
}

test('portable execution plan recognizes the shared nirs4all fixture', () => {
  const fixture = readFileSync(fixtureUrl, 'utf8');
  const plan = parseExecutionPlan(fixture);

  assert.equal(plan.splitter.type, 'KennardStone');
  assert.deepEqual(plan.preprocessing.map((step) => step.type), ['StandardNormalVariate', 'SavitzkyGolay']);
  assert.deepEqual(plan.preprocessing[1].params, [11, 2, 0, 4, 0]);
  assert.deepEqual(plan.nComponents, [2, 4, 6, 8, 10]);
});

test('portable execution plan keeps nirs4all Savitzky-Golay defaults', () => {
  const plan = parseExecutionPlan({
    pipeline: [
      { class: 'nirs4all.operators.transforms.SavitzkyGolay', params: { window_length: 11 } },
      {
        model: {
          class: 'sklearn.cross_decomposition.PLSRegression',
          params: { n_components: 2 },
        },
      },
    ],
  });

  assert.deepEqual(plan.preprocessing[0].params, [11, 3, 0, 4, 0]);
});

test('portable execution plan preserves Savitzky-Golay mode and cval', () => {
  const plan = parseExecutionPlan({
    pipeline: [
      {
        class: 'nirs4all.operators.transforms.SavitzkyGolay',
        params: { window_length: 11, mode: 'constant', cval: 7.25 },
      },
      {
        model: {
          class: 'sklearn.cross_decomposition.PLSRegression',
          params: { n_components: 2 },
        },
      },
    ],
  });

  assert.deepEqual(plan.preprocessing[0].params, [11, 3, 0, 1, 7.25]);
});

test('portable execution plan rejects lossy operator parameter coercions', () => {
  assert.throws(() => parseExecutionPlan({
    pipeline: [
      { class: 'nirs4all.operators.transforms.SavitzkyGolay', params: { window_length: 10.5 } },
      {
        model: {
          class: 'sklearn.cross_decomposition.PLSRegression',
          params: { n_components: 2 },
        },
      },
    ],
  }), /window_length must be an integer/);

  assert.throws(() => parseExecutionPlan({
    pipeline: [
      {
        model: {
          class: 'sklearn.cross_decomposition.PLSRegression',
          params: { n_components: 1.5 },
        },
      },
    ],
  }), /n_components must be an integer/);

  assert.throws(() => parseExecutionPlan({
    pipeline: [
      {
        model: { class: 'sklearn.cross_decomposition.PLSRegression' },
        param: 'n_components',
        _range_: [0, 4, 2],
      },
    ],
  }), /n_components range start must be >= 1/);

  assert.throws(() => parseExecutionPlan({
    pipeline: [
      {
        model: { class: 'sklearn.cross_decomposition.PLSRegression' },
        param: 'n_components',
        _range_: [4, 2, 1],
      },
    ],
  }), /start must be <= stop/);
});

test('portable WASM execution delegates the shared pipeline to nirs4all-methods', async (t) => {
  const artifact = requireMethodsArtifact(t);
  if (!artifact) {
    return;
  }

  const methods = await import(artifact.indexUrl.href);
  const dataset = makeDataset();
  const result = await runPortablePipeline(readFileSync(fixtureUrl, 'utf8'), dataset, { methods });

  assert.equal(result.name, 'portable_methods_pipeline');
  assert.equal(result.split.kind, 'KennardStone');
  assert.equal(result.variants.length, 5);
  assert.equal(result.targets.length, result.split.testIndices.length);
  assert.equal(result.selected.rmse, Math.min(...result.variants.map((item) => item.rmse)));
  assert.equal(result.model.type, 'PLSRegression');
  assert.equal(result.model.n_components, result.selected.n_components);
  assert.ok(result.selected.predictions.every(Number.isFinite));

  const predicted = await predictPortablePipeline(result, { X: dataset.X, rows: dataset.rows, cols: dataset.cols }, { methods });
  assert.equal(predicted.rows, dataset.rows);
  assert.equal(predicted.cols, 1);
  const heldOut = result.split.testIndices.map((index) => predicted.data[index]);
  assert.ok(maxAbsDiff(heldOut, result.selected.predictions) <= 1e-10);
});
