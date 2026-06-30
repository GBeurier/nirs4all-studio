import type { ParameterSweep, SweepType } from "./types";

export type SweepChoice = string | number | boolean;

export interface SweepPreset {
  label: string;
  sweep: ParameterSweep;
  forParams?: string[];
}

export const SWEEP_PREVIEW_LIMIT = 8;
export const SWEEP_PRESET_LIMIT = 6;
export const SWEEP_TYPE_OPTIONS = [
  "range",
  "log_range",
  "or",
] as const satisfies readonly SweepType[];

export const QUICK_SWEEP_PRESETS: SweepPreset[] = [
  {
    label: "1\u219210",
    sweep: { type: "range", from: 1, to: 10, step: 1 },
    forParams: ["n_components", "n_splits"],
  },
  {
    label: "1\u219220",
    sweep: { type: "range", from: 1, to: 20, step: 1 },
    forParams: ["n_components"],
  },
  {
    label: "1\u219230",
    sweep: { type: "range", from: 1, to: 30, step: 1 },
    forParams: ["n_components"],
  },
  {
    label: "5\u219225 step 5",
    sweep: { type: "range", from: 5, to: 25, step: 5 },
    forParams: ["n_components", "n_estimators"],
  },
  {
    label: "0.001\u2192100 log",
    sweep: { type: "log_range", from: 0.001, to: 100, count: 10 },
    forParams: ["alpha", "C", "gamma"],
  },
  {
    label: "0.0001\u21920.1 log",
    sweep: { type: "log_range", from: 0.0001, to: 0.1, count: 5 },
    forParams: ["learning_rate", "lr"],
  },
  {
    label: "3\u219215 odd",
    sweep: { type: "range", from: 3, to: 15, step: 2 },
    forParams: ["window_length", "window"],
  },
  {
    label: "0, 1, 2",
    sweep: { type: "or", choices: [0, 1, 2] },
    forParams: ["deriv", "order", "polyorder"],
  },
];

export function buildEnableSweepDefault(currentValue: SweepChoice): ParameterSweep {
  if (typeof currentValue === "number") {
    return {
      type: "range",
      from: Math.max(1, Math.floor(currentValue * 0.5)),
      to: Math.ceil(currentValue * 1.5) || currentValue + 10,
      step: currentValue >= 10 ? Math.ceil(currentValue * 0.1) : 1,
    };
  }

  return {
    type: "or",
    choices: [currentValue],
  };
}

export function buildSweepTypeDefault(
  currentValue: SweepChoice,
  type: SweepType
): ParameterSweep | undefined {
  if (type === "range") {
    const val = typeof currentValue === "number" ? currentValue : 10;
    return {
      type: "range",
      from: Math.max(1, Math.floor(val * 0.5)),
      to: Math.ceil(val * 1.5) || val + 10,
      step: 1,
    };
  }

  if (type === "log_range") {
    const val = typeof currentValue === "number" ? Math.max(0.001, currentValue) : 1;
    return {
      type: "log_range",
      from: Math.max(0.0001, val * 0.1),
      to: val * 10,
      count: 5,
    };
  }

  if (type === "or") {
    return {
      type: "or",
      choices: [currentValue],
    };
  }

  return undefined;
}

export function getSweepPreviewValues(
  sweep: ParameterSweep | undefined,
  limit = SWEEP_PREVIEW_LIMIT
): SweepChoice[] {
  if (!sweep) return [];

  switch (sweep.type) {
    case "range": {
      const from = sweep.from ?? 0;
      const to = sweep.to ?? 10;
      const step = sweep.step ?? 1;
      const values: number[] = [];
      for (let value = from; value <= to && values.length < limit; value += step) {
        values.push(value);
      }
      return values;
    }
    case "log_range": {
      const from = sweep.from ?? 0.001;
      const to = sweep.to ?? 100;
      const count = sweep.count ?? 5;
      const logFrom = Math.log10(from);
      const logTo = Math.log10(to);
      const logStep = (logTo - logFrom) / (count - 1);
      const values: number[] = [];
      for (let index = 0; index < count && values.length < limit; index++) {
        values.push(Math.pow(10, logFrom + index * logStep));
      }
      return values;
    }
    case "or":
      return (sweep.choices ?? []).slice(0, limit);
    default:
      return [];
  }
}

export function getRelevantSweepPresets(
  paramKey: string,
  presets: readonly SweepPreset[] = QUICK_SWEEP_PRESETS
): SweepPreset[] {
  const normalizedParamKey = paramKey.toLowerCase();

  return presets.filter(
    (preset) =>
      !preset.forParams ||
      preset.forParams.some((param) => {
        const normalizedPresetParam = param.toLowerCase();
        return (
          normalizedParamKey.includes(normalizedPresetParam) ||
          normalizedPresetParam.includes(normalizedParamKey)
        );
      })
  );
}

export function formatSweepValue(value: unknown): string {
  if (typeof value === "number") {
    if (value < 0.001 || value >= 10000) return value.toExponential(1);
    if (value % 1 !== 0) return value.toPrecision(3);
    return String(value);
  }

  return String(value);
}

export function parseSweepChoices(input: string, coerceNumbers: boolean): SweepChoice[] {
  return input
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (trimmed === "") return null;
      const num = parseFloat(trimmed);
      if (!isNaN(num) && coerceNumbers) return num;
      if (trimmed === "true") return true;
      if (trimmed === "false") return false;
      return trimmed;
    })
    .filter((value): value is SweepChoice => value !== null);
}
