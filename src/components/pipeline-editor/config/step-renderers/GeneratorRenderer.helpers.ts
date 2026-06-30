/**
 * GeneratorRenderer.helpers - Pure logic for generator step configuration.
 *
 * These helpers hold the load-bearing, framework-agnostic logic the
 * GeneratorRenderer component relies on: selection combinatorics and the
 * read/write mapping between a UI-friendly {@link SelectionConfig} and the
 * persisted `step.generatorOptions`. Keeping them pure (no React, no DOM)
 * makes them unit-testable and reusable as new generator kinds / backends
 * are added.
 */

import type { PipelineStep, ScalarGeneratorEntry } from "../../types";

// ---------------------------------------------------------------------------
// Selection types
// ---------------------------------------------------------------------------

export type PrimarySelectionMode = "none" | "pick" | "arrange";
export type SecondarySelectionMode = "none" | "then_pick" | "then_arrange";
export type SelectionValue = number | [number, number];

export interface SelectionConfig {
  primaryMode: PrimarySelectionMode;
  primaryValue?: SelectionValue;
  secondaryMode: SecondarySelectionMode;
  secondaryValue?: SelectionValue;
  count?: number;
  seed?: number;
}

// ---------------------------------------------------------------------------
// Combinatorics helpers
// ---------------------------------------------------------------------------

export function isRange(value: SelectionValue | undefined): value is [number, number] {
  return Array.isArray(value) && value.length === 2;
}

export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

export function permutations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result *= n - i;
  }
  return result;
}

export function calculateVariantsForValue(
  optionCount: number,
  mode: "pick" | "arrange",
  value: SelectionValue
): number {
  if (isRange(value)) {
    const [from, to] = value;
    let total = 0;
    for (let k = from; k <= to; k++) {
      total += mode === "pick" ? combinations(optionCount, k) : permutations(optionCount, k);
    }
    return total;
  }
  return mode === "pick" ? combinations(optionCount, value) : permutations(optionCount, value);
}

export function calculatePrimarySelectionCount(
  config: SelectionConfig,
  supportsPickArrange: boolean,
  selectionBaseCount: number,
): number {
  if (!supportsPickArrange) {
    return selectionBaseCount;
  }
  if (config.primaryMode === "arrange") {
    return calculateVariantsForValue(
      selectionBaseCount,
      "arrange",
      config.primaryValue || 1,
    );
  }
  if (config.primaryMode === "pick") {
    return calculateVariantsForValue(
      selectionBaseCount,
      "pick",
      config.primaryValue || 1,
    );
  }
  return selectionBaseCount;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export interface GeneratorOptionCountInput {
  generatorKind: string;
  scalarEntryCount: number;
  sampleCount: number;
  branchCount: number;
}

export function getGeneratorOptionCount({
  generatorKind,
  scalarEntryCount,
  sampleCount,
  branchCount,
}: GeneratorOptionCountInput): number {
  if (generatorKind === "grid" || generatorKind === "zip") {
    return scalarEntryCount;
  }
  if (generatorKind === "sample") {
    return sampleCount;
  }
  return branchCount;
}

export function formatSelectionValue(value: SelectionValue | undefined): string {
  if (value === undefined) return "";
  if (isRange(value)) return `${value[0]} to ${value[1]}`;
  return String(value);
}

export function getPrimarySelectionDescription(
  config: SelectionConfig,
  selectionBaseCount: number,
): string {
  if (config.primaryMode === "none") {
    return "";
  }
  if (isRange(config.primaryValue)) {
    return `All ${config.primaryMode === "pick" ? "combinations" : "permutations"} from ${config.primaryValue[0]} to ${config.primaryValue[1]}`;
  }
  if (config.primaryMode === "pick") {
    return `C(${selectionBaseCount}, ${config.primaryValue || 1}) = ${combinations(selectionBaseCount, (config.primaryValue as number) || 1)} combinations`;
  }
  return `P(${selectionBaseCount}, ${config.primaryValue || 1}) = ${permutations(selectionBaseCount, (config.primaryValue as number) || 1)} permutations`;
}

export function getPrimarySelectionSummary(
  config: SelectionConfig,
  generatorKind: string,
): string {
  if (config.primaryMode === "none") {
    return generatorKind === "cartesian"
      ? "All stage combinations"
      : "Each option tested individually";
  }
  if (config.primaryMode === "pick") {
    return isRange(config.primaryValue)
      ? `All combinations from ${config.primaryValue[0]} to ${config.primaryValue[1]}`
      : `All ${config.primaryValue}-combinations`;
  }
  return isRange(config.primaryValue)
    ? `All permutations from ${config.primaryValue[0]} to ${config.primaryValue[1]}`
    : `All ${config.primaryValue}-permutations`;
}

export function getSecondarySelectionSummary(config: SelectionConfig): string | undefined {
  if (config.secondaryMode === "then_pick") {
    return `\u2192 Then pick ${formatSelectionValue(config.secondaryValue)} from results`;
  }
  if (config.secondaryMode === "then_arrange") {
    return `\u2192 Then arrange ${formatSelectionValue(config.secondaryValue)} from results`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Draft / scalar entry helpers
// ---------------------------------------------------------------------------

export function stringifyJsonDraft(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "";
}

export function createScalarEntryDrafts(
  entries: Pick<ScalarGeneratorEntry, "id" | "values">[],
): Record<string, string> {
  return Object.fromEntries(
    entries.map((entry) => [entry.id, stringifyJsonDraft(entry.values)]),
  );
}

export function parseJsonArrayDraft(draft: string): unknown[] | undefined {
  try {
    const parsed = JSON.parse(draft);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function addScalarEntry(
  entries: ScalarGeneratorEntry[],
  id: string,
): ScalarGeneratorEntry[] {
  return [
    ...entries,
    {
      id,
      key: `param_${entries.length + 1}`,
      values: [],
    },
  ];
}

export function removeScalarEntry(
  entries: ScalarGeneratorEntry[],
  entryId: string,
): ScalarGeneratorEntry[] {
  return entries.filter((entry) => entry.id !== entryId);
}

export function renameScalarEntry(
  entries: ScalarGeneratorEntry[],
  entryId: string,
  key: string,
): ScalarGeneratorEntry[] {
  return entries.map((entry) =>
    entry.id === entryId ? { ...entry, key } : entry,
  );
}

export function updateScalarEntryValues(
  entries: ScalarGeneratorEntry[],
  entryId: string,
  values: unknown[],
): ScalarGeneratorEntry[] {
  return entries.map((entry) =>
    entry.id === entryId ? { ...entry, values } : entry,
  );
}

// ---------------------------------------------------------------------------
// Config extraction / serialization
// ---------------------------------------------------------------------------

export function extractConfig(step: PipelineStep): SelectionConfig {
  const opts = step.generatorOptions || {};

  let primaryMode: PrimarySelectionMode = "none";
  let primaryValue: SelectionValue | undefined;

  if (opts.arrange !== undefined) {
    primaryMode = "arrange";
    primaryValue = opts.arrange;
  } else if (opts.pick !== undefined) {
    primaryMode = "pick";
    primaryValue = opts.pick;
  }

  let secondaryMode: SecondarySelectionMode = "none";
  let secondaryValue: SelectionValue | undefined;

  if (opts.then_arrange !== undefined) {
    secondaryMode = "then_arrange";
    secondaryValue = opts.then_arrange;
  } else if (opts.then_pick !== undefined) {
    secondaryMode = "then_pick";
    secondaryValue = opts.then_pick;
  }

  return {
    primaryMode,
    primaryValue,
    secondaryMode,
    secondaryValue,
    count: opts.count,
    seed: (step.params as Record<string, unknown>)?._seed_ as number | undefined,
  };
}

export function configToOptions(config: SelectionConfig): PipelineStep["generatorOptions"] {
  const opts: PipelineStep["generatorOptions"] = {};

  if (config.primaryMode === "pick" && config.primaryValue !== undefined) {
    opts.pick = config.primaryValue;
  } else if (config.primaryMode === "arrange" && config.primaryValue !== undefined) {
    opts.arrange = config.primaryValue;
  }

  if (config.secondaryMode === "then_pick" && config.secondaryValue !== undefined) {
    opts.then_pick = config.secondaryValue;
  }
  if (config.secondaryMode === "then_arrange" && config.secondaryValue !== undefined) {
    opts.then_arrange = config.secondaryValue;
  }

  if (config.count && config.count > 0) {
    opts.count = config.count;
  }

  return opts;
}
