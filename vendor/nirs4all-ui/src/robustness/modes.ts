import {
  getKeywordRegistryEntry,
  isKeywordRegistryDocument,
  type KeywordRegistryDocument,
} from "../keywordRegistry/index.js";
import type { RobustnessMode } from "./summary.js";

export const ROBUSTNESS_MODES = [
  "clean_frozen",
  "matched_recalibration",
  "structural_refit",
] as const;

export const ROBUSTNESS_EXECUTABLE_MODES = [
  "clean_frozen",
] as const;

export type RobustnessExecutableMode = typeof ROBUSTNESS_EXECUTABLE_MODES[number];

export interface RobustnessModeOption {
  disabled: boolean;
  executable: boolean;
  label: string;
  value: RobustnessMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function labelRobustnessMode(mode: RobustnessMode): string {
  return mode.replace(/_/g, " ");
}

export function isRobustnessMode(value: unknown): value is RobustnessMode {
  return (
    typeof value === "string"
    && ROBUSTNESS_MODES.includes(value as RobustnessMode)
  );
}

export function isRobustnessExecutableMode(value: unknown): value is RobustnessExecutableMode {
  return (
    typeof value === "string"
    && ROBUSTNESS_EXECUTABLE_MODES.includes(value as RobustnessExecutableMode)
  );
}

function modeOptionsFromModes(
  modes: readonly RobustnessMode[],
  executableModes: readonly RobustnessMode[],
): RobustnessModeOption[] {
  return modes.map((mode) => {
    const executable = executableModes.includes(mode);
    return {
      disabled: !executable,
      executable,
      label: labelRobustnessMode(mode),
      value: mode,
    };
  });
}

export function getRobustnessModeOptions(): RobustnessModeOption[] {
  return modeOptionsFromModes(ROBUSTNESS_MODES, ROBUSTNESS_EXECUTABLE_MODES);
}

function modeEnumFromRegistry(registry: KeywordRegistryDocument): unknown[] | undefined {
  const entry = getKeywordRegistryEntry(registry, "robustness.mode");
  const valueSchema = entry?.value_schema;
  return Array.isArray(valueSchema?.enum) ? valueSchema.enum : undefined;
}

function executableModeEnumFromRegistry(registry: KeywordRegistryDocument): unknown[] | undefined {
  const entry = getKeywordRegistryEntry(registry, "robustness.mode");
  const valueSchema = entry?.value_schema;
  if (!isRecord(valueSchema)) return undefined;
  const executableValues = valueSchema["x-executable-values"];
  return Array.isArray(executableValues) ? executableValues : undefined;
}

export function getRobustnessModeOptionsFromRegistry(
  registry: unknown,
): RobustnessModeOption[] {
  if (!isKeywordRegistryDocument(registry)) return getRobustnessModeOptions();

  const modes = modeEnumFromRegistry(registry)?.filter(isRobustnessMode);
  if (modes === undefined || modes.length === 0) {
    return getRobustnessModeOptions();
  }

  const executableModes = executableModeEnumFromRegistry(registry)
    ?.filter(isRobustnessMode);
  return modeOptionsFromModes(
    modes,
    executableModes !== undefined && executableModes.length > 0
      ? executableModes
      : ROBUSTNESS_EXECUTABLE_MODES,
  );
}
