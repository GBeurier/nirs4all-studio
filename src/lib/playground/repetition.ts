import type { SampleMetadata, SpectralData } from '@/types/spectral';

const DIRECT_REPETITION_COLUMN_NAMES = new Set([
  'bio_sample',
  'bio_sample_id',
  'biosample',
  'biosampleid',
  'biologicalsample',
  'biologicalsampleid',
  'sample_group',
  'samplegroup',
  'group_id',
  'groupid',
]);

const SAMPLE_ID_COLUMN_NAMES = ['sample_id', 'sampleid', 'sample_name', 'samplename', 'sample_code', 'samplecode'];

const SAMPLE_ID_PATTERNS = [
  /^(.+?)[-_][Rr]ep\d+$/,
  /^(.+?)[-_][Rr]\d+$/,
  /^(.+?)[-_]\d+$/,
  /^(.+?)[-_][A-Za-z]$/,
  /^(.+?)\s*\(\d+\)$/,
];

export type RepetitionDetectionMethod = 'auto' | 'metadata' | 'pattern';

export type RepetitionDistanceMetric = 'pca' | 'umap' | 'euclidean' | 'mahalanobis';

export interface RepetitionDetectionConfig {
  method: RepetitionDetectionMethod;
  metadataColumn?: string;
  pattern?: string;
  distanceMetric: RepetitionDistanceMetric;
}

export interface RepetitionPatternPreset {
  label: string;
  pattern: string;
  example: string;
}

export interface DetectedRepetitionGroup {
  bioSample: string;
  sampleIds: string[];
  count: number;
}

export interface RepetitionDetectionSummary {
  bioSamples: number;
  totalReps: number;
  avgReps: number;
}

export const DEFAULT_REPETITION_PATTERN = '^(.+?)[-_][Rr]ep\\d+$';

export const COMMON_REPETITION_PATTERNS: RepetitionPatternPreset[] = [
  { label: 'sample_rep1, sample_rep2', pattern: DEFAULT_REPETITION_PATTERN, example: 'Sample1_rep1' },
  { label: 'sample_1, sample_2', pattern: '^(.+?)[-_]\\d+$', example: 'Sample1_1' },
  { label: 'sample_A, sample_B', pattern: '^(.+?)[-_][A-Za-z]$', example: 'Sample1_A' },
  { label: 'sample (1), sample (2)', pattern: '^(.+?)\\s*\\(\\d+\\)$', example: 'Sample1 (1)' },
  { label: 'Custom pattern...', pattern: '', example: '' },
];

export const CUSTOM_REPETITION_PATTERN_INDEX = COMMON_REPETITION_PATTERNS.length - 1;

function normalizeColumnToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeColumnName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getMetadataKeys(metadata?: SampleMetadata[]): string[] {
  if (!Array.isArray(metadata) || metadata.length === 0) {
    return [];
  }

  const keys = new Set<string>();
  for (const row of metadata) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    for (const key of Object.keys(row)) {
      keys.add(key);
    }
  }

  return Array.from(keys);
}

function findMetadataColumn(
  columnNames: string[],
  predicate: (normalized: string) => boolean,
): string | undefined {
  for (const columnName of columnNames) {
    if (predicate(normalizeColumnToken(columnName))) {
      return columnName;
    }
  }
  return undefined;
}

function hasRepeatedValues(values: unknown[]): boolean {
  const counts = new Map<string, number>();

  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if ((counts.get(key) ?? 0) >= 2) {
      return true;
    }
  }

  return false;
}

function getRepeatedGroupStats(values: unknown[]): { repeatedGroups: number; repeatedMeasurements: number } {
  const counts = new Map<string, number>();

  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let repeatedGroups = 0;
  let repeatedMeasurements = 0;
  for (const count of counts.values()) {
    if (count >= 2) {
      repeatedGroups += 1;
      repeatedMeasurements += count;
    }
  }

  return { repeatedGroups, repeatedMeasurements };
}

function hasRepeatedSampleIdPattern(sampleIds?: string[]): boolean {
  if (!Array.isArray(sampleIds) || sampleIds.length < 2) {
    return false;
  }

  for (const pattern of SAMPLE_ID_PATTERNS) {
    const counts = new Map<string, number>();

    for (const sampleId of sampleIds) {
      const value = String(sampleId);
      const match = pattern.exec(value);
      const key = match ? match[1] : value;

      counts.set(key, (counts.get(key) ?? 0) + 1);
      if ((counts.get(key) ?? 0) >= 2) {
        return true;
      }
    }
  }

  return false;
}

export function validateRepetitionPattern(pattern: string): string | null {
  if (!pattern) {
    return null;
  }

  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return `Invalid regex: ${(error as Error).message}`;
  }
}

export function detectRepetitionGroupsFromPattern(
  sampleIds: string[],
  pattern: string,
): DetectedRepetitionGroup[] {
  if (sampleIds.length === 0 || !pattern) {
    return [];
  }

  const regex = new RegExp(pattern);
  const groups: Map<string, string[]> = new Map();

  for (const sampleId of sampleIds) {
    const match = regex.exec(sampleId);
    const bioSample = match ? match[1] : sampleId;
    if (!groups.has(bioSample)) {
      groups.set(bioSample, []);
    }
    groups.get(bioSample)!.push(sampleId);
  }

  return Array.from(groups.entries())
    .filter(([, samples]) => samples.length >= 2)
    .map(([bioSample, samples]) => ({
      bioSample,
      sampleIds: samples,
      count: samples.length,
    }));
}

export function detectRepetitionGroups(
  sampleIds: string[],
  method: RepetitionDetectionMethod,
  pattern?: string,
): DetectedRepetitionGroup[] {
  if (sampleIds.length === 0) {
    return [];
  }

  if (method === 'auto') {
    let bestGroups: DetectedRepetitionGroup[] = [];
    let bestRepCount = 0;

    for (const preset of COMMON_REPETITION_PATTERNS) {
      if (!preset.pattern) {
        continue;
      }

      try {
        const groups = detectRepetitionGroupsFromPattern(sampleIds, preset.pattern);
        const repCount = groups.reduce((sum, group) => sum + group.count, 0);
        if (repCount > bestRepCount) {
          bestRepCount = repCount;
          bestGroups = groups;
        }
      } catch {
        // Pattern presets are static, but keep auto-detection defensive.
      }
    }

    return bestGroups;
  }

  if (method === 'pattern' && pattern) {
    try {
      return detectRepetitionGroupsFromPattern(sampleIds, pattern);
    } catch {
      return [];
    }
  }

  return [];
}

export function summarizeRepetitionGroups(
  groups: DetectedRepetitionGroup[],
): RepetitionDetectionSummary {
  if (groups.length === 0) {
    return { bioSamples: 0, totalReps: 0, avgReps: 0 };
  }

  const totalReps = groups.reduce((sum, group) => sum + group.count, 0);
  return {
    bioSamples: groups.length,
    totalReps,
    avgReps: totalReps / groups.length,
  };
}

export function isLikelyRepeatIndexColumnName(columnName: string): boolean {
  const normalized = normalizeColumnToken(columnName);
  if (!normalized) {
    return false;
  }

  return (
    normalized === 'rep' ||
    normalized === 'reps' ||
    normalized.startsWith('replicate') ||
    normalized.startsWith('repeat') ||
    normalized.startsWith('repetition') ||
    normalized.startsWith('technicalrep')
  );
}

export function getRepeatIndexColumnWarning(columnName?: string | null): string | null {
  const normalized = normalizeColumnName(columnName);
  if (!normalized || !isLikelyRepeatIndexColumnName(normalized)) {
    return null;
  }

  return `Column '${normalized}' looks like a repetition counter, not a biological sample/group identifier. Use the column whose repeated rows belong to the same physical sample.`;
}

export function findLikelyRepetitionColumn(metadata?: SampleMetadata[]): string | undefined {
  const columnNames = getMetadataKeys(metadata);
  if (columnNames.length === 0) {
    return undefined;
  }

  if (!metadata) {
    return undefined;
  }

  const candidates: {
    columnName: string;
    isPreferredName: boolean;
    repeatedGroups: number;
    repeatedMeasurements: number;
  }[] = [];

  for (const columnName of columnNames) {
    const normalized = normalizeColumnToken(columnName);
    if (
      isLikelyRepeatIndexColumnName(normalized) ||
      ['set', 'partition', 'fold', 'foldid'].includes(normalized)
    ) {
      continue;
    }

    const values = metadata.map((row) => row?.[columnName]);
    const stats = getRepeatedGroupStats(values);
    if (stats.repeatedGroups === 0) {
      continue;
    }

    const isPreferredName =
      DIRECT_REPETITION_COLUMN_NAMES.has(normalized) ||
      (normalized.includes('bio') && normalized.includes('sample')) ||
      (normalized.includes('sample') && normalized.includes('group'));
    if (!isPreferredName) {
      continue;
    }

    candidates.push({
      columnName,
      isPreferredName,
      repeatedGroups: stats.repeatedGroups,
      repeatedMeasurements: stats.repeatedMeasurements,
    });
  }

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((a, b) => {
    if (a.isPreferredName !== b.isPreferredName) {
      return a.isPreferredName ? -1 : 1;
    }
    if (a.repeatedGroups !== b.repeatedGroups) {
      return b.repeatedGroups - a.repeatedGroups;
    }
    if (a.repeatedMeasurements !== b.repeatedMeasurements) {
      return b.repeatedMeasurements - a.repeatedMeasurements;
    }
    return a.columnName.localeCompare(b.columnName, undefined, { numeric: true });
  });

  return candidates[0]?.columnName;
}

export function getSpectralRepetitionColumn(
  data?: Pick<SpectralData, 'metadata' | 'repetitionColumn'> | null,
): string | undefined {
  const explicitColumn = normalizeColumnName(data?.repetitionColumn);
  if (explicitColumn) {
    return explicitColumn;
  }

  return findLikelyRepetitionColumn(data?.metadata);
}

export function getColumnarMetadata(metadata?: SampleMetadata[]): Record<string, unknown[]> | undefined {
  const columnNames = getMetadataKeys(metadata);
  if (columnNames.length === 0 || !metadata) {
    return undefined;
  }

  const result: Record<string, unknown[]> = {};
  for (const columnName of columnNames) {
    result[columnName] = metadata.map((row) => row?.[columnName]);
  }

  return result;
}

export function getSampleIdsFromMetadata(metadata?: SampleMetadata[]): string[] | undefined {
  if (!Array.isArray(metadata) || metadata.length === 0) {
    return undefined;
  }

  const columnNames = getMetadataKeys(metadata);
  const sampleIdColumn = findMetadataColumn(
    columnNames,
    (normalized) => SAMPLE_ID_COLUMN_NAMES.includes(normalized),
  );
  if (!sampleIdColumn) {
    return undefined;
  }

  const sampleIds = metadata.map((row) => {
    const value = row?.[sampleIdColumn];
    return value === null || value === undefined || value === '' ? null : String(value);
  });

  return sampleIds.every((value) => value !== null) ? sampleIds : undefined;
}

export function hasSpectralRepetitionGroups(
  data?: Pick<SpectralData, 'metadata' | 'repetitionColumn' | 'sampleIds'> | null,
): boolean {
  const repetitionColumn = getSpectralRepetitionColumn(data);
  if (repetitionColumn && Array.isArray(data?.metadata) && data.metadata.length > 1) {
    const values = data.metadata.map((row) => row?.[repetitionColumn]);
    if (hasRepeatedValues(values)) {
      return true;
    }
  }

  return hasRepeatedSampleIdPattern(data?.sampleIds);
}
