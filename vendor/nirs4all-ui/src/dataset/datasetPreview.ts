/**
 * Pure dataset preview view-model helpers.
 *
 * Hosts keep ownership of dataset loading and schema adapters; this module only
 * turns small, package-level display contracts into reusable labels, stats, and
 * badges for Studio/Web dataset cards.
 */

export type DatasetPreviewTaskKind = "regression" | "classification" | "mixed" | "unknown";

export type DatasetPreviewTone = "default" | "muted" | "warning";

export type DatasetPreviewCount = number | string | null | undefined;

export interface DatasetSplitCountInput {
  id?: string | null;
  key?: string | null;
  label?: string | null;
  count?: DatasetPreviewCount;
}

export type DatasetSplitCountsInput =
  | readonly DatasetSplitCountInput[]
  | Record<string, DatasetPreviewCount>;

export interface DatasetSpectralRangeInput {
  start?: DatasetPreviewCount;
  end?: DatasetPreviewCount;
  min?: DatasetPreviewCount;
  max?: DatasetPreviewCount;
  unit?: string | null;
}

export interface DatasetPreviewInput {
  id?: string | null;
  name?: string | null;
  title?: string | null;
  description?: string | null;
  taskType?: string | null;
  sampleCount?: DatasetPreviewCount;
  spectrumCount?: DatasetPreviewCount;
  rowCount?: DatasetPreviewCount;
  featureCount?: DatasetPreviewCount;
  wavelengthCount?: DatasetPreviewCount;
  targetCount?: DatasetPreviewCount;
  classCount?: DatasetPreviewCount;
  splitCounts?: DatasetSplitCountsInput | null;
  splits?: DatasetSplitCountsInput | null;
  spectralRange?: DatasetSpectralRangeInput | readonly [DatasetPreviewCount, DatasetPreviewCount] | null;
  tags?: readonly (string | null | undefined)[] | null;
}

export interface DatasetSplitCountView {
  id: string;
  label: string;
  count: number;
  countLabel: string;
  percentage: number | null;
  percentageLabel: string | null;
}

export interface DatasetPreviewBadge {
  id: string;
  label: string;
  tone: DatasetPreviewTone;
}

export interface DatasetPreviewStat {
  id: "samples" | "features" | "targets" | "classes" | "splits" | "range";
  label: string;
  value: string;
  detail: string | null;
  tone: DatasetPreviewTone;
}

export interface DatasetPreviewView {
  id: string | null;
  title: string;
  description: string | null;
  taskKind: DatasetPreviewTaskKind;
  taskLabel: string;
  sampleCount: number | null;
  sampleCountLabel: string | null;
  featureCount: number | null;
  featureCountLabel: string | null;
  targetCount: number | null;
  targetCountLabel: string | null;
  classCount: number | null;
  classCountLabel: string | null;
  spectralRangeLabel: string | null;
  splitCounts: DatasetSplitCountView[];
  splitSummaryLabel: string | null;
  tags: string[];
  badges: DatasetPreviewBadge[];
  stats: DatasetPreviewStat[];
}

function readTrimmedString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFiniteNumber(value: DatasetPreviewCount): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseDatasetCount(value: DatasetPreviewCount): number | null {
  const parsed = parseFiniteNumber(value);
  return parsed != null && parsed >= 0 ? Math.trunc(parsed) : null;
}

function firstDatasetCount(...values: DatasetPreviewCount[]): number | null {
  for (const value of values) {
    const count = parseDatasetCount(value);
    if (count != null) return count;
  }
  return null;
}

const COUNT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const RANGE_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function formatDatasetCount(
  value: DatasetPreviewCount,
  singular: string,
  plural = `${singular}s`,
): string | null {
  const count = parseDatasetCount(value);
  if (count == null) return null;
  return `${COUNT_FORMATTER.format(count)} ${count === 1 ? singular : plural}`;
}

function formatCountValue(value: number | null): string {
  return value == null ? "Unknown" : COUNT_FORMATTER.format(value);
}

function normalizeLookupToken(value: string | null | undefined): string {
  return readTrimmedString(value)?.toLowerCase().replace(/[\s_]+/g, "-") ?? "";
}

export function resolveDatasetTaskKind(taskType: string | null | undefined): DatasetPreviewTaskKind {
  const normalized = normalizeLookupToken(taskType);
  if (!normalized) return "unknown";
  if (normalized.includes("mixed") || normalized.includes("multi-task")) return "mixed";
  if (normalized.includes("class")) return "classification";
  if (normalized.includes("regress")) return "regression";
  return "unknown";
}

export function formatDatasetTaskLabel(taskType: string | null | undefined): string {
  const kind = resolveDatasetTaskKind(taskType);
  if (kind === "classification") return "Classification";
  if (kind === "regression") return "Regression";
  if (kind === "mixed") return "Mixed tasks";

  const trimmed = readTrimmedString(taskType);
  if (!trimmed) return "Dataset";
  return formatDatasetTokenLabel(trimmed);
}

export function formatDatasetTokenLabel(value: string | null | undefined): string {
  const trimmed = readTrimmedString(value);
  if (!trimmed) return "";

  return trimmed
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "id") return "ID";
      if (lower === "nirs") return "NIRS";
      if (lower === "nir") return "NIR";
      if (lower === "uv") return "UV";
      if (lower === "vis") return "VIS";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function percentageLabel(percentage: number | null): string | null {
  if (percentage == null) return null;
  return `${RANGE_FORMATTER.format(percentage)}%`;
}

function splitEntries(input: DatasetSplitCountsInput | null | undefined): DatasetSplitCountInput[] {
  if (!input) return [];
  if (Array.isArray(input)) return [...input];

  return Object.entries(input).map(([key, count]) => ({
    id: key,
    count,
  }));
}

function isSpectralRangeTuple(
  range: DatasetPreviewInput["spectralRange"],
): range is readonly [DatasetPreviewCount, DatasetPreviewCount] {
  return Array.isArray(range);
}

export function normalizeDatasetSplitCounts(
  input: DatasetSplitCountsInput | null | undefined,
  sampleCount?: DatasetPreviewCount,
): DatasetSplitCountView[] {
  const total = parseDatasetCount(sampleCount);
  const seen = new Set<string>();

  return splitEntries(input)
    .map((entry, index): DatasetSplitCountView | null => {
      const count = parseDatasetCount(entry.count);
      if (count == null) return null;

      const rawId = readTrimmedString(entry.id) ?? readTrimmedString(entry.key) ?? readTrimmedString(entry.label);
      const id = normalizeLookupToken(rawId) || `split-${index + 1}`;
      if (seen.has(id)) return null;
      seen.add(id);

      const percentage = total && total > 0
        ? Math.round((count / total) * 1000) / 10
        : null;

      return {
        id,
        label: readTrimmedString(entry.label) ?? (formatDatasetTokenLabel(rawId) || `Split ${index + 1}`),
        count,
        countLabel: formatDatasetCount(count, "sample") ?? "0 samples",
        percentage,
        percentageLabel: percentageLabel(percentage),
      };
    })
    .filter((entry): entry is DatasetSplitCountView => entry != null);
}

function readSpectralRangeValue(
  range: DatasetPreviewInput["spectralRange"],
  keys: readonly ("start" | "end" | "min" | "max")[],
): number | null {
  if (!range) return null;
  if (isSpectralRangeTuple(range)) {
    const index = keys.includes("start") || keys.includes("min") ? 0 : 1;
    return parseFiniteNumber(range[index]);
  }

  for (const key of keys) {
    const value = parseFiniteNumber(range[key]);
    if (value != null) return value;
  }

  return null;
}

function readSpectralRangeUnit(range: DatasetPreviewInput["spectralRange"]): string {
  if (!range || isSpectralRangeTuple(range)) return "nm";
  return readTrimmedString(range.unit) ?? "nm";
}

export function formatDatasetSpectralRange(
  range: DatasetPreviewInput["spectralRange"],
): string | null {
  const start = readSpectralRangeValue(range, ["start", "min"]);
  const end = readSpectralRangeValue(range, ["end", "max"]);
  if (start == null && end == null) return null;

  const unit = readSpectralRangeUnit(range);
  if (start != null && end != null) {
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    return `${RANGE_FORMATTER.format(lower)}-${RANGE_FORMATTER.format(upper)} ${unit}`;
  }
  if (start != null) return `from ${RANGE_FORMATTER.format(start)} ${unit}`;
  if (end != null) return `up to ${RANGE_FORMATTER.format(end)} ${unit}`;
  return null;
}

function normalizeTags(tags: DatasetPreviewInput["tags"]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags ?? []) {
    const label = readTrimmedString(tag);
    if (!label) continue;
    const key = normalizeLookupToken(label);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(label);
  }

  return normalized;
}

function buildSplitSummaryLabel(splits: readonly DatasetSplitCountView[]): string | null {
  if (splits.length === 0) return null;
  return splits
    .map((split) => split.percentageLabel
      ? `${split.label} ${split.percentageLabel}`
      : `${split.label} ${split.countLabel}`)
    .join(", ");
}

function buildBadges(
  taskLabel: string,
  taskKind: DatasetPreviewTaskKind,
  splitSummaryLabel: string | null,
  spectralRangeLabel: string | null,
  tags: readonly string[],
): DatasetPreviewBadge[] {
  const badges: DatasetPreviewBadge[] = [
    {
      id: "task",
      label: taskLabel,
      tone: taskKind === "unknown" ? "muted" : "default",
    },
  ];

  if (spectralRangeLabel) {
    badges.push({ id: "range", label: spectralRangeLabel, tone: "muted" });
  }
  if (splitSummaryLabel) {
    badges.push({ id: "splits", label: splitSummaryLabel, tone: "muted" });
  }

  for (const tag of tags) {
    badges.push({
      id: `tag-${normalizeLookupToken(tag)}`,
      label: tag,
      tone: "default",
    });
  }

  return badges;
}

function buildStats(view: Omit<DatasetPreviewView, "badges" | "stats">): DatasetPreviewStat[] {
  const stats: DatasetPreviewStat[] = [
    {
      id: "samples",
      label: "Samples",
      value: formatCountValue(view.sampleCount),
      detail: view.splitSummaryLabel,
      tone: view.sampleCount == null ? "warning" : "default",
    },
    {
      id: "features",
      label: "Features",
      value: formatCountValue(view.featureCount),
      detail: view.spectralRangeLabel,
      tone: view.featureCount == null ? "muted" : "default",
    },
  ];

  if (view.classCount != null) {
    stats.push({
      id: "classes",
      label: "Classes",
      value: formatCountValue(view.classCount),
      detail: view.targetCountLabel,
      tone: "default",
    });
  } else if (view.targetCount != null) {
    stats.push({
      id: "targets",
      label: "Targets",
      value: formatCountValue(view.targetCount),
      detail: null,
      tone: "default",
    });
  }

  if (view.splitCounts.length > 0) {
    stats.push({
      id: "splits",
      label: "Splits",
      value: COUNT_FORMATTER.format(view.splitCounts.length),
      detail: view.splitSummaryLabel,
      tone: "muted",
    });
  }

  if (view.spectralRangeLabel && view.featureCount == null) {
    stats.push({
      id: "range",
      label: "Range",
      value: view.spectralRangeLabel,
      detail: null,
      tone: "muted",
    });
  }

  return stats;
}

export function buildDatasetPreview(
  input: DatasetPreviewInput | null | undefined,
): DatasetPreviewView | null {
  if (!input) return null;

  const title = readTrimmedString(input.title)
    ?? readTrimmedString(input.name)
    ?? readTrimmedString(input.id)
    ?? "Untitled dataset";
  const description = readTrimmedString(input.description);
  const taskKind = resolveDatasetTaskKind(input.taskType);
  const taskLabel = formatDatasetTaskLabel(input.taskType);
  const sampleCount = firstDatasetCount(input.sampleCount, input.spectrumCount, input.rowCount);
  const featureCount = firstDatasetCount(input.featureCount, input.wavelengthCount);
  const targetCount = parseDatasetCount(input.targetCount);
  const classCount = parseDatasetCount(input.classCount);
  const splitCounts = normalizeDatasetSplitCounts(input.splitCounts ?? input.splits, sampleCount);
  const splitSummaryLabel = buildSplitSummaryLabel(splitCounts);
  const spectralRangeLabel = formatDatasetSpectralRange(input.spectralRange);
  const tags = normalizeTags(input.tags);
  const baseView = {
    id: readTrimmedString(input.id),
    title,
    description,
    taskKind,
    taskLabel,
    sampleCount,
    sampleCountLabel: formatDatasetCount(sampleCount, "sample"),
    featureCount,
    featureCountLabel: formatDatasetCount(featureCount, "feature"),
    targetCount,
    targetCountLabel: formatDatasetCount(targetCount, "target"),
    classCount,
    classCountLabel: formatDatasetCount(classCount, "class", "classes"),
    spectralRangeLabel,
    splitCounts,
    splitSummaryLabel,
    tags,
  };

  return {
    ...baseView,
    badges: buildBadges(taskLabel, taskKind, splitSummaryLabel, spectralRangeLabel, tags),
    stats: buildStats(baseView),
  };
}
