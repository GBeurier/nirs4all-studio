import type {
  SpectraChartConfig,
  SpectraFilterConfig,
  WavelengthFocusConfig,
} from '@/lib/playground/spectraConfig';

type NumericRange = [number, number];

export interface RangeLabels {
  start: string;
  end: string;
}

export interface SpectraSettingsReadModelInput {
  config: SpectraChartConfig;
  wavelengthRange: NumericRange;
  wavelengthUnitSuffix?: string;
  yRange?: NumericRange;
  metadataColumns?: string[];
}

export interface SpectraSettingsReadModel {
  modifiedCount: number;
  focusModifiedCount: number;
  filterModifiedCount: number;
  wavelengthRangeLabels: RangeLabels;
  targetRangeLabels: RangeLabels | null;
  metadataPreviewText: string | null;
}

export function countFocusModifiedSettings(focus: WavelengthFocusConfig): number {
  let count = 0;

  if (focus.range !== null) count++;
  if (focus.derivative > 0) count++;
  if (focus.edgeMask.enabled) count++;

  return count;
}

export function countFilterModifiedSettings(filters: SpectraFilterConfig): number {
  let count = 0;

  if (filters.partition !== 'all') count++;
  if (filters.targetRange) count++;
  if (filters.qcStatus && filters.qcStatus !== 'all') count++;

  return count;
}

export function countSpectraSettingsModifications(config: SpectraChartConfig): number {
  return countFocusModifiedSettings(config.wavelengthFocus) + countFilterModifiedSettings(config.filters);
}

export function buildWavelengthRangeLabels(
  focusRange: NumericRange | null,
  wavelengthRange: NumericRange,
  wavelengthUnitSuffix = ''
): RangeLabels {
  return {
    start: `${(focusRange?.[0] ?? wavelengthRange[0]).toFixed(0)}${wavelengthUnitSuffix}`,
    end: `${(focusRange?.[1] ?? wavelengthRange[1]).toFixed(0)}${wavelengthUnitSuffix}`,
  };
}

export function buildTargetRangeLabels(
  targetRange: NumericRange | undefined,
  yRange: NumericRange | undefined
): RangeLabels | null {
  if (!yRange) {
    return null;
  }

  return {
    start: (targetRange?.[0] ?? yRange[0]).toFixed(2),
    end: (targetRange?.[1] ?? yRange[1]).toFixed(2),
  };
}

export function buildMetadataPreviewText(metadataColumns: string[] | undefined): string | null {
  if (!metadataColumns || metadataColumns.length === 0) {
    return null;
  }

  const preview = metadataColumns.slice(0, 2).join(', ');
  const remainingCount = metadataColumns.length - 2;
  const suffix = remainingCount > 0 ? ` +${remainingCount} more` : '';

  return `Coming soon: Filter by ${preview}${suffix}`;
}

export function buildSpectraSettingsReadModel({
  config,
  wavelengthRange,
  wavelengthUnitSuffix = '',
  yRange,
  metadataColumns,
}: SpectraSettingsReadModelInput): SpectraSettingsReadModel {
  const focusModifiedCount = countFocusModifiedSettings(config.wavelengthFocus);
  const filterModifiedCount = countFilterModifiedSettings(config.filters);

  return {
    modifiedCount: focusModifiedCount + filterModifiedCount,
    focusModifiedCount,
    filterModifiedCount,
    wavelengthRangeLabels: buildWavelengthRangeLabels(
      config.wavelengthFocus.range,
      wavelengthRange,
      wavelengthUnitSuffix
    ),
    targetRangeLabels: buildTargetRangeLabels(config.filters.targetRange, yRange),
    metadataPreviewText: buildMetadataPreviewText(metadataColumns),
  };
}
