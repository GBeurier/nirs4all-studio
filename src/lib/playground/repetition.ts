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

  const candidates = columnNames
    .map((columnName) => {
      const normalized = normalizeColumnToken(columnName);
      if (
        !metadata ||
        isLikelyRepeatIndexColumnName(normalized) ||
        ['set', 'partition', 'fold', 'foldid'].includes(normalized)
      ) {
        return null;
      }

      const values = metadata.map((row) => row?.[columnName]);
      const stats = getRepeatedGroupStats(values);
      if (stats.repeatedGroups === 0) {
        return null;
      }

      const isPreferredName =
        DIRECT_REPETITION_COLUMN_NAMES.has(normalized) ||
        (normalized.includes('bio') && normalized.includes('sample')) ||
        (normalized.includes('sample') && normalized.includes('group'));
      if (!isPreferredName) {
        return null;
      }

      return {
        columnName,
        isPreferredName,
        repeatedGroups: stats.repeatedGroups,
        repeatedMeasurements: stats.repeatedMeasurements,
      };
    })
    .filter((candidate): candidate is {
      columnName: string;
      isPreferredName: boolean;
      repeatedGroups: number;
      repeatedMeasurements: number;
    } => candidate !== null);

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
