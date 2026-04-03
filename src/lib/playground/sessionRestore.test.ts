import { describe, expect, it } from 'vitest';
import { hasPersistedPlaygroundPipelineState } from './sessionRestore';

describe('hasPersistedPlaygroundPipelineState', () => {
  it('returns false when pipeline storage is missing', () => {
    expect(hasPersistedPlaygroundPipelineState(null)).toBe(false);
  });

  it('returns false when pipeline storage is invalid JSON', () => {
    expect(hasPersistedPlaygroundPipelineState('{invalid')).toBe(false);
  });

  it('returns false when pipeline storage is not an array', () => {
    expect(hasPersistedPlaygroundPipelineState('{"operators":[]}')).toBe(false);
  });

  it('returns true when pipeline storage contains an array', () => {
    expect(hasPersistedPlaygroundPipelineState('[]')).toBe(true);
    expect(
      hasPersistedPlaygroundPipelineState('[{"id":"snv-1","name":"SNV","type":"preprocessing","params":{},"enabled":true}]')
    ).toBe(true);
  });
});
