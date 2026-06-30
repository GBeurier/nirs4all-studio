import { describe, expect, it } from 'vitest';

import { buildDatasetSchemaRef } from '@/lib/datasetSchema';
import {
  buildPlaygroundSpectralProjection,
  getPlaygroundProjectionMetadataColumns,
  getPlaygroundProjectionSampleCount,
  getPlaygroundProjectionTargetColumn,
  getDefaultDataView,
  isPlaygroundSpectralProjection,
  resolvePlaygroundMetadataColumns,
  type PlaygroundDataViewProjection,
} from '@/lib/playground/dataViewProjection';
import type { Dataset } from '@/types/datasets';

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'corn',
    name: 'Corn',
    path: '/data/corn.csv',
    linked_at: '2026-01-01T00:00:00',
    num_samples: 12,
    num_features: 144,
    n_sources: 2,
    default_target: 'protein',
    metadata_columns: ['batch'],
    targets: [{ column: 'protein', type: 'regression' }],
    config: {
      delimiter: ',',
      decimal_separator: '.',
      has_header: true,
      repetition: 'sample_id',
    },
    ...overrides,
  };
}

describe('playground data-view projection', () => {
  it('builds a legacy spectral compatibility projection without a schema ref', () => {
    expect(buildPlaygroundSpectralProjection({
      sampleCount: 3,
      featureCount: 5,
    })).toEqual({
      id: 'legacy-spectral:view:default',
      label: 'Legacy spectral view',
      source: 'legacy-spectral',
      representationIds: ['legacy-spectral:representation:spectra'],
      sampleCount: 3,
      featureCount: 5,
      targetColumn: null,
      metadataColumns: [],
      repetitionColumn: null,
      sourceCount: null,
      isSpectralCompatible: true,
    });
  });

  it('uses schema default view fields while preserving runtime dimensions', () => {
    const schemaRef = buildDatasetSchemaRef(dataset());
    const defaultDataView = getDefaultDataView(schemaRef);

    expect(buildPlaygroundSpectralProjection({
      schemaRef,
      defaultDataView,
      sampleCount: 2,
      featureCount: 3,
    })).toEqual({
      id: 'corn:view:default',
      label: 'Default spectral view',
      source: 'schema-ref',
      representationIds: [
        'corn:representation:spectra',
        'corn:representation:targets',
        'corn:representation:metadata',
        'corn:representation:grouping',
      ],
      sampleCount: 2,
      featureCount: 3,
      targetColumn: 'protein',
      metadataColumns: ['batch'],
      repetitionColumn: 'sample_id',
      sourceCount: 2,
      isSpectralCompatible: true,
    });
  });

  it('falls back to schema dimensions before default-view dimensions for unloaded datasets', () => {
    const schemaRef = buildDatasetSchemaRef(dataset());

    expect(buildPlaygroundSpectralProjection({
      schemaRef,
      sampleCount: 0,
      featureCount: 0,
    })).toMatchObject({
      source: 'schema-ref',
      sampleCount: 12,
      featureCount: 144,
      isSpectralCompatible: true,
    });
  });

  it('centralizes spectral compatibility checks with legacy fallback semantics', () => {
    const spectralProjection = buildPlaygroundSpectralProjection({
      sampleCount: 3,
      featureCount: 5,
    });
    const nonSpectralProjection: PlaygroundDataViewProjection = {
      ...spectralProjection,
      id: 'corn:view:metadata',
      label: 'Metadata view',
      representationIds: ['corn:representation:metadata'],
      featureCount: 0,
      isSpectralCompatible: false,
    };

    expect(isPlaygroundSpectralProjection(undefined)).toBe(true);
    expect(isPlaygroundSpectralProjection(null)).toBe(true);
    expect(isPlaygroundSpectralProjection(spectralProjection)).toBe(true);
    expect(isPlaygroundSpectralProjection(nonSpectralProjection)).toBe(false);
  });

  it('centralizes projection metadata-column fallback rules', () => {
    const projection = buildPlaygroundSpectralProjection({
      schemaRef: buildDatasetSchemaRef(dataset()),
      sampleCount: 0,
      featureCount: 0,
    });
    const projectionWithoutMetadata: PlaygroundDataViewProjection = {
      ...projection,
      metadataColumns: [],
    };

    expect(getPlaygroundProjectionMetadataColumns(projection)).toEqual(['batch']);
    expect(getPlaygroundProjectionMetadataColumns(projectionWithoutMetadata)).toBeUndefined();
    expect(getPlaygroundProjectionMetadataColumns(null)).toBeUndefined();
    expect(resolvePlaygroundMetadataColumns(['explicit'], projection)).toEqual(['explicit']);
    expect(resolvePlaygroundMetadataColumns(undefined, projection)).toEqual(['batch']);
  });

  it('centralizes projection target-column access for target views', () => {
    const projection = buildPlaygroundSpectralProjection({
      schemaRef: buildDatasetSchemaRef(dataset()),
      sampleCount: 0,
      featureCount: 0,
    });

    expect(getPlaygroundProjectionTargetColumn(projection)).toBe('protein');
    expect(getPlaygroundProjectionTargetColumn(null)).toBeUndefined();
  });

  it('centralizes projection sample-count access for row identity fallbacks', () => {
    const projection = buildPlaygroundSpectralProjection({
      schemaRef: buildDatasetSchemaRef(dataset()),
      sampleCount: 4,
      featureCount: 0,
    });

    expect(getPlaygroundProjectionSampleCount(projection)).toBe(4);
    expect(getPlaygroundProjectionSampleCount({
      ...projection,
      sampleCount: 0,
    })).toBeUndefined();
    expect(getPlaygroundProjectionSampleCount(null)).toBeUndefined();
  });
});
