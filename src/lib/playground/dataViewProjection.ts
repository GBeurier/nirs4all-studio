import type {
  DataViewRef,
  DatasetSchemaRef,
} from '@/lib/datasetSchema';
import {
  getDatasetDefaultDataView,
  getDatasetSchemaViewCounts,
} from '@/lib/datasetSchemaAccessors';

export type PlaygroundDataViewProjectionSource = 'schema-ref' | 'legacy-spectral';

export interface PlaygroundDataViewProjection {
  id: string;
  label: string;
  source: PlaygroundDataViewProjectionSource;
  representationIds: string[];
  sampleCount: number;
  featureCount: number;
  targetColumn: string | null;
  metadataColumns: string[];
  repetitionColumn: string | null;
  sourceCount: number | null;
  isSpectralCompatible: boolean;
}

export interface BuildPlaygroundSpectralProjectionInput {
  schemaRef?: DatasetSchemaRef | null;
  defaultDataView?: DataViewRef | null;
  sampleCount: number;
  featureCount: number;
}

export function isPlaygroundSpectralProjection(
  dataView: PlaygroundDataViewProjection | null | undefined,
): boolean {
  return dataView?.isSpectralCompatible ?? true;
}

export function getPlaygroundProjectionMetadataColumns(
  dataView: PlaygroundDataViewProjection | null | undefined,
): string[] | undefined {
  return dataView?.metadataColumns.length ? dataView.metadataColumns : undefined;
}

export function resolvePlaygroundMetadataColumns(
  metadataColumns: string[] | undefined,
  dataView: PlaygroundDataViewProjection | null | undefined,
): string[] | undefined {
  return metadataColumns ?? getPlaygroundProjectionMetadataColumns(dataView);
}

export function getPlaygroundProjectionTargetColumn(
  dataView: PlaygroundDataViewProjection | null | undefined,
): string | null | undefined {
  return dataView?.targetColumn;
}

export function getPlaygroundProjectionSampleCount(
  dataView: PlaygroundDataViewProjection | null | undefined,
): number | undefined {
  return dataView && dataView.sampleCount > 0 ? dataView.sampleCount : undefined;
}

export function getDefaultDataView(schemaRef: DatasetSchemaRef | null | undefined): DataViewRef | null {
  return getDatasetDefaultDataView(schemaRef);
}

function hasSpectralRepresentation(schemaRef: DatasetSchemaRef | null | undefined): boolean {
  return Boolean(schemaRef?.representations.some((representation) =>
    representation.kind === 'spectra' && representation.available,
  ));
}

export function buildPlaygroundSpectralProjection({
  schemaRef = null,
  defaultDataView = getDefaultDataView(schemaRef),
  sampleCount,
  featureCount,
}: BuildPlaygroundSpectralProjectionInput): PlaygroundDataViewProjection {
  if (schemaRef) {
    const counts = getDatasetSchemaViewCounts(schemaRef, defaultDataView);
    return {
      id: defaultDataView?.id ?? `${schemaRef.datasetId}:view:spectral-compat`,
      label: defaultDataView?.label ?? 'Spectral compatibility view',
      source: 'schema-ref',
      representationIds: defaultDataView?.representationIds ?? [],
      sampleCount: sampleCount || counts.sampleCount || 0,
      featureCount: featureCount || counts.featureCount || 0,
      targetColumn: defaultDataView?.targetColumn ?? schemaRef.defaultTargetColumn,
      metadataColumns: defaultDataView?.metadataColumns ?? schemaRef.metadataColumns,
      repetitionColumn: defaultDataView?.repetitionColumn ?? schemaRef.repetitionColumn,
      sourceCount: counts.sourceCount,
      isSpectralCompatible: featureCount > 0 || hasSpectralRepresentation(schemaRef),
    };
  }

  return {
    id: 'legacy-spectral:view:default',
    label: 'Legacy spectral view',
    source: 'legacy-spectral',
    representationIds: featureCount > 0 ? ['legacy-spectral:representation:spectra'] : [],
    sampleCount,
    featureCount,
    targetColumn: null,
    metadataColumns: [],
    repetitionColumn: null,
    sourceCount: null,
    isSpectralCompatible: featureCount > 0,
  };
}
