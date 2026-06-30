import { describe, expect, it } from 'vitest';

import { buildPlaygroundDataView } from '@/lib/playground/dataView';
import { buildDatasetSchemaRef } from '@/lib/datasetSchema';
import type { Dataset } from '@/types/datasets';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

function createResult(overrides: Partial<PlaygroundResult> = {}): PlaygroundResult {
  return {
    original: {
      spectra: [],
      wavelengths: [],
      shape: [0, 0],
    },
    processed: {
      spectra: [],
      wavelengths: [],
      shape: [0, 0],
    },
    executionTimeMs: 0,
    trace: [],
    errors: [],
    ...overrides,
  };
}

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'd1',
    name: 'Corn',
    path: '/data/corn.csv',
    linked_at: '2026-01-01T00:00:00',
    num_samples: 10,
    num_features: 100,
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

describe('buildPlaygroundDataView', () => {
  it('returns an empty view without data', () => {
    const view = buildPlaygroundDataView(null, null);

    expect(view).toMatchObject({
      hasRawData: false,
      hasProcessedSpectra: false,
      rawSampleCount: 0,
      processedSampleCount: 0,
      sampleCount: 0,
      rawFeatureCount: 0,
      processedFeatureCount: 0,
      featureCount: 0,
      processedSpectraExport: null,
    });
    expect(view.spectralProjection).toEqual({
      id: 'legacy-spectral:view:default',
      label: 'Legacy spectral view',
      source: 'legacy-spectral',
      representationIds: [],
      sampleCount: 0,
      featureCount: 0,
      targetColumn: null,
      metadataColumns: [],
      repetitionColumn: null,
      sourceCount: null,
      isSpectralCompatible: false,
    });
  });

  it('summarizes raw spectral data when no processed result exists', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2, 3], [4, 5, 6]],
      wavelengths: [1100, 1200, 1300],
      y: [10, 20],
      sampleIds: ['s1', 's2'],
    };

    const view = buildPlaygroundDataView(rawData, null);

    expect(view.hasRawData).toBe(true);
    expect(view.hasProcessedSpectra).toBe(false);
    expect(view.rawSampleCount).toBe(2);
    expect(view.rawFeatureCount).toBe(3);
    expect(view.sampleCount).toBe(2);
    expect(view.featureCount).toBe(3);
    expect(view.processedSpectraExport).toBeNull();
    expect(view.schemaRef).toMatchObject({
      datasetId: 'playground:legacy',
      featureCount: 3,
      sampleCount: 2,
      source: 'legacy-dataset',
      targetColumns: ['target'],
    });
    expect(view.defaultDataView).toMatchObject({
      id: 'playground:legacy:view:default',
      targetColumn: 'target',
    });
    expect(view.spectralProjection).toMatchObject({
      source: 'schema-ref',
      id: 'playground:legacy:view:default',
      sampleCount: 2,
      featureCount: 3,
      representationIds: [
        'playground:legacy:representation:spectra',
        'playground:legacy:representation:targets',
      ],
      isSpectralCompatible: true,
    });
  });

  it('builds processed spectra export content with processed row metadata first', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4], [5, 6]],
      wavelengths: [1100, 1200],
      y: [1, 2, 3],
      sampleIds: ['raw-1', 'raw-2', 'raw-3'],
    };
    const result = createResult({
      processed: {
        spectra: [[10, 20], [30, 40]],
        wavelengths: [1110, 1210],
        y: [12, 34],
        sample_ids: ['processed-1', 'processed-2'],
        shape: [2, 2],
      },
    });

    const view = buildPlaygroundDataView(rawData, result);

    expect(view.hasProcessedSpectra).toBe(true);
    expect(view.processedSampleCount).toBe(2);
    expect(view.processedFeatureCount).toBe(2);
    expect(view.sampleCount).toBe(2);
    expect(view.featureCount).toBe(2);
    expect(view.processedSpectraExport).toEqual({
      spectra: [[10, 20], [30, 40]],
      wavelengths: [1110, 1210],
      y: [12, 34],
      sampleIds: ['processed-1', 'processed-2'],
    });
  });

  it('falls back to raw target and sample ids only when they match processed rows', () => {
    const rawData: SpectralData = {
      spectra: [[1], [2]],
      wavelengths: [1100],
      y: [10, 20],
      sampleIds: ['s1', 's2'],
    };
    const result = createResult({
      processed: {
        spectra: [[10], [20]],
        wavelengths: [1100],
        shape: [2, 1],
      },
    });

    expect(buildPlaygroundDataView(rawData, result).processedSpectraExport).toEqual({
      spectra: [[10], [20]],
      wavelengths: [1100],
      y: [10, 20],
      sampleIds: ['s1', 's2'],
    });

    const filteredResult = createResult({
      processed: {
        spectra: [[10]],
        wavelengths: [1100],
        shape: [1, 1],
      },
    });

    expect(buildPlaygroundDataView(rawData, filteredResult).processedSpectraExport).toEqual({
      spectra: [[10]],
      wavelengths: [1100],
      y: undefined,
      sampleIds: undefined,
    });
  });

  it('attaches schema-backed spectral projections when a dataset schema ref is available', () => {
    const rawData: SpectralData = {
      spectra: [[1, 2, 3], [4, 5, 6]],
      wavelengths: [1100, 1200, 1300],
      y: [10, 20],
      sampleIds: ['s1', 's2'],
    };
    const schemaRef = buildDatasetSchemaRef(dataset());

    const view = buildPlaygroundDataView(rawData, null, schemaRef);

    expect(view.schemaRef).toBe(schemaRef);
    expect(view.defaultDataView).toEqual(schemaRef.dataViews[0]);
    expect(view.spectralProjection).toEqual({
      id: 'd1:view:default',
      label: 'Default spectral view',
      source: 'schema-ref',
      representationIds: [
        'd1:representation:spectra',
        'd1:representation:targets',
        'd1:representation:metadata',
        'd1:representation:grouping',
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

  it('falls back to schema dimensions when no raw spectral matrix is loaded yet', () => {
    const schemaRef = buildDatasetSchemaRef(dataset());
    const view = buildPlaygroundDataView(null, null, schemaRef);

    expect(view.hasRawData).toBe(false);
    expect(view.sampleCount).toBe(0);
    expect(view.featureCount).toBe(0);
    expect(view.spectralProjection).toMatchObject({
      source: 'schema-ref',
      sampleCount: 10,
      featureCount: 100,
      targetColumn: 'protein',
      sourceCount: 2,
      isSpectralCompatible: true,
    });
  });
});
