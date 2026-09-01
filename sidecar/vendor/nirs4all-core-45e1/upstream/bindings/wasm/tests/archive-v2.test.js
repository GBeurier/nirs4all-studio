import assert from 'node:assert/strict';
import test from 'node:test';

import { loadArchiveV2Native, replayMethodsArchiveV2 } from '../src/index.js';

const dataset = {
  X: [[1.5, 0.5], [3.5, 1.5]],
  rows: 2,
  cols: 2,
  sampleIds: ['predict.0', 'predict.1'],
};

test('Archive V2 native surface is a Rust/WASM validator', async () => {
  const native = await loadArchiveV2Native();
  assert.equal(typeof native.ValidatedMethodsArchiveV2, 'function');
  assert.throws(
    () => new native.ValidatedMethodsArchiveV2(new Uint8Array([0x4e, 0x34, 0x61])),
    /Core Archive V2 refusal/,
  );
});

test('invalid Archive V2 refuses before Methods is observed', async () => {
  await assert.rejects(
    replayMethodsArchiveV2(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), dataset),
    /Core Archive V2 refusal/,
  );
});

test('host matrix and identity contracts refuse before archive validation', async () => {
  await assert.rejects(
    replayMethodsArchiveV2(new Uint8Array(), {
      ...dataset,
      X: [[Number.NaN, 0.5], [3.5, 1.5]],
    }),
    /finite-value contract/,
  );

  await assert.rejects(
    replayMethodsArchiveV2(new Uint8Array(), {
      ...dataset,
      sampleIds: ['predict.0', 'predict.0'],
    }),
    /distinct bounded identity strings/,
  );

  const neverIterate = {
    *[Symbol.iterator]() {
      throw new Error('sample ID iterable must not be consumed');
    },
  };
  await assert.rejects(
    replayMethodsArchiveV2(new Uint8Array(), {
      ...dataset,
      sampleIds: neverIterate,
    }),
    /sample IDs must be an array matching the row count/,
  );
});

test('runtime dependency injection cannot bypass Core or Methods authority', async () => {
  let injectedObserved = false;
  const injected = new Proxy({}, {
    get() {
      injectedObserved = true;
      throw new Error('injected dependency must never be observed');
    },
  });
  await assert.rejects(
    replayMethodsArchiveV2(new Uint8Array([0x00]), dataset, {
      archiveNative: injected,
      methods: injected,
    }),
    /Core Archive V2 refusal/,
  );
  assert.equal(injectedObserved, false);
});
