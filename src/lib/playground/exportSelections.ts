import type { SavedSelection } from '@/context/useSelection';

export interface SelectionPayloadOptions {
  sampleIds?: string[];
  includeBoth?: boolean;
  exportedAt?: string;
}

export interface SelectionCsvOptions {
  sampleIds?: string[];
  includeBoth?: boolean;
}

export interface SelectionImportResult {
  selections: SavedSelection[];
  warnings: string[];
  /** Number of sample IDs that couldn't be mapped to indices */
  unmappedCount: number;
}

export interface SelectionImportOptions {
  createId?: () => string;
  now?: () => Date;
}

function defaultCreateId(): string {
  return `sel-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined;
}

function numberArray(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number')
    ? value
    : undefined;
}

function buildIdToIndex(sampleIds?: string[]): Map<string, number> {
  const idToIndex = new Map<string, number>();
  sampleIds?.forEach((id, idx) => {
    idToIndex.set(id, idx);
  });
  return idToIndex;
}

export function buildSelectionsExportPayload(
  selections: SavedSelection[],
  options: SelectionPayloadOptions = {},
): Record<string, unknown> {
  const { sampleIds, includeBoth = true, exportedAt = new Date().toISOString() } = options;
  const hasUsableSampleIds = Boolean(sampleIds?.length);

  return {
    version: '2.0',
    exportedAt,
    count: selections.length,
    hasSampleIds: Boolean(sampleIds),
    selections: selections.map((selection) => {
      const exportedSelection: Record<string, unknown> = {
        id: selection.id,
        name: selection.name,
        color: selection.color,
        createdAt: selection.createdAt instanceof Date
          ? selection.createdAt.toISOString()
          : selection.createdAt,
      };

      if (hasUsableSampleIds) {
        exportedSelection.sampleIds = selection.indices
          .filter((index) => index >= 0 && index < sampleIds!.length)
          .map((index) => sampleIds![index]);
        if (includeBoth) {
          exportedSelection.indices = selection.indices;
        }
      } else {
        exportedSelection.indices = selection.indices;
      }

      return exportedSelection;
    }),
  };
}

export function buildSelectionCsv(
  indices: number[],
  options: SelectionCsvOptions = {},
): string {
  const { sampleIds, includeBoth = false } = options;
  const useIds = Boolean(sampleIds?.length);
  const headers: string[] = [];

  if (includeBoth || !useIds) {
    headers.push('index');
  }
  if (useIds) {
    headers.push('sample_id');
  }

  const rows = indices.map((index) => {
    const row: (string | number)[] = [];
    if (includeBoth || !useIds) {
      row.push(index);
    }
    if (useIds) {
      row.push(index >= 0 && index < sampleIds!.length ? sampleIds![index] : '');
    }
    return row.join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function parseSelectionsJson(
  jsonString: string,
  sampleIds?: string[],
  options: SelectionImportOptions = {},
): SelectionImportResult {
  const warnings: string[] = [];
  let unmappedCount = 0;
  const createId = options.createId ?? defaultCreateId;
  const now = options.now ?? (() => new Date());

  try {
    const data = asRecord(JSON.parse(jsonString));
    const selectionRecords = Array.isArray(data?.selections) ? data.selections : null;
    if (!selectionRecords) {
      throw new Error('Invalid selections format: missing selections array');
    }

    const idToIndex = buildIdToIndex(sampleIds);
    const selections = selectionRecords.flatMap((rawSelection): SavedSelection[] => {
      const selection = asRecord(rawSelection);
      const name = stringValue(selection?.name);
      if (!selection || !name) {
        warnings.push('Skipping invalid selection: missing name');
        return [];
      }

      let indices = numberArray(selection.indices) ?? [];
      const importedSampleIds = stringArray(selection.sampleIds);

      if (indices.length === 0 && importedSampleIds?.length) {
        if (sampleIds && idToIndex.size > 0) {
          indices = importedSampleIds
            .map((sampleId) => {
              const index = idToIndex.get(sampleId);
              if (index === undefined) {
                unmappedCount++;
                return -1;
              }
              return index;
            })
            .filter((index) => index >= 0);

          if (indices.length < importedSampleIds.length) {
            warnings.push(
              `Selection "${name}": ${importedSampleIds.length - indices.length} sample IDs could not be mapped`,
            );
          }
        } else {
          warnings.push(`Selection "${name}": has sample IDs but no mapping provided, skipping`);
          return [];
        }
      } else if (indices.length === 0) {
        warnings.push(`Skipping selection "${name}": no indices or sample IDs`);
        return [];
      }

      if (indices.length === 0) {
        warnings.push(`Skipping selection "${name}": empty after mapping`);
        return [];
      }

      return [{
        id: stringValue(selection.id) ?? createId(),
        name,
        indices,
        color: stringValue(selection.color),
        createdAt: stringValue(selection.createdAt)
          ? new Date(stringValue(selection.createdAt)!)
          : now(),
      }];
    });

    return { selections, warnings, unmappedCount };
  } catch (error) {
    throw new Error(
      `Failed to parse selections: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

export function parseSelectionCsv(
  csvString: string,
  sampleIds?: string[],
): { indices: number[]; warnings: string[]; unmappedCount: number } {
  const warnings: string[] = [];
  let unmappedCount = 0;

  try {
    const lines = csvString.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have header row and at least one data row');
    }

    const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
    const indexCol = headers.indexOf('index');
    const sampleIdCol = headers.indexOf('sample_id');

    if (indexCol === -1 && sampleIdCol === -1) {
      throw new Error('CSV must have "index" or "sample_id" column');
    }

    const idToIndex = sampleIdCol !== -1 ? buildIdToIndex(sampleIds) : new Map<string, number>();
    const indices: number[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(',').map((column) => column.trim());
      if (indexCol !== -1 && cols[indexCol]) {
        const index = parseInt(cols[indexCol], 10);
        if (!Number.isNaN(index) && index >= 0) {
          indices.push(index);
          continue;
        }
      }

      if (sampleIdCol !== -1 && cols[sampleIdCol]) {
        const index = idToIndex.get(cols[sampleIdCol]);
        if (index !== undefined) {
          indices.push(index);
        } else {
          unmappedCount++;
        }
      }
    }

    if (unmappedCount > 0) {
      warnings.push(`${unmappedCount} sample IDs could not be mapped to indices`);
    }

    return { indices, warnings, unmappedCount };
  } catch (error) {
    throw new Error(
      `Failed to parse CSV: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
