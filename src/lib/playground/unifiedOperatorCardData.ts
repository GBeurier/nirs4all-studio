import type { MetadataColumnInfo } from '@/api/playground';
import type { OperatorParamInfo, UnifiedOperator } from '@/types/playground';
import type { SampleMetadata } from '@/types/spectral';

export interface SplitRuntimeParamMetadata {
  runtimeOnlyParams?: readonly string[];
}

export interface UnifiedOperatorTypeFlags {
  isSplitter: boolean;
  isFilter: boolean;
  isAugmentation: boolean;
}

export interface UnifiedOperatorBorderState extends UnifiedOperatorTypeFlags {
  hasError: boolean;
}

export function inferMetadataDtype(values: Array<string | number | boolean | null | undefined>): string {
  const firstDefined = values.find((value) => value !== null && value !== undefined);
  if (firstDefined === undefined) return 'unknown';
  return typeof firstDefined;
}

export function buildLocalMetadataColumns(metadataRows?: SampleMetadata[]): MetadataColumnInfo[] {
  if (!metadataRows || metadataRows.length === 0) {
    return [];
  }

  const valuesByColumn = new Map<string, Array<string | number | boolean | null>>();
  for (const row of metadataRows) {
    for (const [key, value] of Object.entries(row)) {
      const columnValues = valuesByColumn.get(key) ?? [];
      columnValues.push(value ?? null);
      valuesByColumn.set(key, columnValues);
    }
  }

  return Array.from(valuesByColumn.entries()).map(([name, values]) => {
    const uniqueValues = Array.from(new Set(values));
    return {
      name,
      dtype: inferMetadataDtype(uniqueValues),
      unique_values: uniqueValues.slice(0, 200),
      n_unique: uniqueValues.length,
    };
  });
}

export function getUnifiedOperatorTypeFlags(type: UnifiedOperator['type']): UnifiedOperatorTypeFlags {
  return {
    isSplitter: type === 'splitting',
    isFilter: type === 'filter',
    isAugmentation: type === 'augmentation',
  };
}

export function formatUnifiedOperatorName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

export function getUnifiedOperatorBorderClass({
  hasError,
  isFilter,
  isSplitter,
  isAugmentation,
}: UnifiedOperatorBorderState): string {
  if (hasError) return 'border-destructive/70';
  if (isFilter) return 'border-red-500/50';
  if (isSplitter) return 'border-orange-500/50';
  if (isAugmentation) return 'border-blue-500/50';
  return 'border-border';
}

export function supportsRuntimeGroupBy(splitMetadata?: SplitRuntimeParamMetadata | null): boolean {
  return Boolean(splitMetadata?.runtimeOnlyParams?.includes('group_by'));
}

export function hasRenderableOperatorParams({
  paramDefs,
  hasRuntimeGroupBy,
}: {
  paramDefs?: Record<string, OperatorParamInfo>;
  hasRuntimeGroupBy: boolean;
}): boolean {
  return Boolean(paramDefs && Object.keys(paramDefs).length > 0) || hasRuntimeGroupBy;
}
