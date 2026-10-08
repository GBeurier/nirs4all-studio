import { describe, expect, it } from 'vitest';
import { coverageSample } from './sampling';

describe('coverage sampling', () => {
  const spectra = Array.from({ length: 40 }, (_, row) =>
    Array.from({ length: 700 }, (_, column) => Math.sin(row * 0.3 + column * 0.01) + row * 0.0003)
  );

  it.each([
    [0, [0, 1, 8, 10, 13, 16, 19, 23, 26, 32]],
    [7, [0, 3, 6, 9, 10, 11, 19, 22, 34, 37]],
    [42, [2, 9, 10, 14, 17, 19, 21, 24, 27, 32]],
  ] as const)('preserves the previous maximin selection with seed %i', (seed, expected) => {
    expect(coverageSample(spectra, 10, seed)).toEqual(expected);
  });

  it('preserves the first candidate on equal distances without duplicates', () => {
    expect(coverageSample(Array.from({ length: 5 }, () => [2, 2]), 4, 42)).toEqual([0, 1, 2, 3]);
  });
});
