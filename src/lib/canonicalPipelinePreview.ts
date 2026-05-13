type CanonicalPreviewGenerator = {
  _or_?: unknown[];
  _range_?: number[];
  _log_range_?: number[];
  _grid_?: Record<string, unknown[]>;
  _zip_?: Record<string, unknown[]>;
  count?: number;
};

export interface CanonicalPreviewStep {
  id: string;
  type: string;
  name: string;
  displayName?: string;
  params?: Record<string, unknown>;
  generator?: CanonicalPreviewGenerator;
  children?: CanonicalPreviewStep[];
  branches?: CanonicalPreviewStep[][];
}

const CANONICAL_STEP_KEYS = new Set([
  "class",
  "function",
  "model",
  "y_processing",
  "split",
  "branch",
  "merge",
  "sample_augmentation",
  "feature_augmentation",
  "sample_filter",
  "exclude",
  "tag",
  "concat_transform",
  "_or_",
  "_cartesian_",
  "_range_",
  "_log_range_",
  "_grid_",
  "_zip_",
  "_chain_",
  "_sample_",
  "chart_2d",
  "chart_y",
]);

type PreviewState = { nextId: number };

function clonePreviewValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => clonePreviewValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        clonePreviewValue(child),
      ])
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isRuntimeOnlyStepRepr(value: unknown): boolean {
  return (
    typeof value === "string"
    && value.includes(" object at 0x")
    && value.trim().startsWith("<")
    && value.trim().endsWith(">")
  );
}

function isCanonicalStepString(value: unknown): boolean {
  return (
    typeof value === "string"
    && (value.includes(".") || value === "chart_2d" || value === "chart_y")
  );
}

function isCanonicalStepRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).some((key) => CANONICAL_STEP_KEYS.has(key));
}

function isCanonicalStepLike(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) {
    return value.every((item) => isCanonicalStepLike(item));
  }
  return isCanonicalStepString(value) || isCanonicalStepRecord(value);
}

function nextPreviewId(state: PreviewState): string {
  state.nextId += 1;
  return `canonical-preview-${state.nextId}`;
}

function toLabel(reference: unknown, fallback = "Step"): string {
  if (typeof reference !== "string") return fallback;
  const trimmed = reference.trim();
  if (!trimmed) return fallback;

  const runtimeMatch = trimmed.match(/([A-Za-z0-9_]+)\s+object at/i);
  if (runtimeMatch?.[1]) {
    return runtimeMatch[1];
  }

  return trimmed.split(".").pop() || trimmed;
}

function toParams(value: unknown): Record<string, unknown> {
  return isRecord(value) ? (clonePreviewValue(value) as Record<string, unknown>) : {};
}

function pickParams(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) {
      params[key] = clonePreviewValue(record[key]);
    }
  }
  return params;
}

function toPreviewStep(
  state: PreviewState,
  partial: Omit<CanonicalPreviewStep, "id">
): CanonicalPreviewStep {
  return {
    id: nextPreviewId(state),
    params: {},
    ...partial,
  };
}

function toPreviewSteps(value: unknown, state: PreviewState): CanonicalPreviewStep[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => toPreviewSteps(item, state));
  }

  const previewStep = convertCanonicalValueToPreviewStep(value, state);
  return previewStep ? [previewStep] : [];
}

function toGenerator(record: Record<string, unknown>): CanonicalPreviewGenerator | undefined {
  const generator: CanonicalPreviewGenerator = {};

  if (Array.isArray(record._or_)) {
    generator._or_ = clonePreviewValue(record._or_) as unknown[];
  }
  if (Array.isArray(record._range_)) {
    generator._range_ = clonePreviewValue(record._range_) as number[];
  }
  if (Array.isArray(record._log_range_)) {
    generator._log_range_ = clonePreviewValue(record._log_range_) as number[];
  }
  if (isRecord(record._grid_)) {
    generator._grid_ = clonePreviewValue(record._grid_) as Record<string, unknown[]>;
  }
  if (isRecord(record._zip_)) {
    generator._zip_ = clonePreviewValue(record._zip_) as Record<string, unknown[]>;
  }
  if (typeof record.count === "number" && record.count > 0) {
    generator.count = record.count;
  }

  return Object.keys(generator).length > 0 ? generator : undefined;
}

function convertCanonicalValueToPreviewStep(
  value: unknown,
  state: PreviewState,
): CanonicalPreviewStep | null {
  if (value == null) {
    return toPreviewStep(state, {
      type: "flow",
      name: "No-op",
      params: {},
    });
  }

  if (typeof value === "string") {
    if (isRuntimeOnlyStepRepr(value)) return null;

    if (value === "chart_2d" || value === "chart_y") {
      return toPreviewStep(state, {
        type: "utility",
        name: value,
        params: {},
      });
    }

    return toPreviewStep(state, {
      type: "preprocessing",
      name: toLabel(value),
      params: {},
    });
  }

  if (!isRecord(value)) {
    return toPreviewStep(state, {
      type: "preprocessing",
      name: "Step",
      params: { value: clonePreviewValue(value) },
    });
  }

  if (isRuntimeOnlyStepRepr(value.class) || isRuntimeOnlyStepRepr(value.function)) {
    return null;
  }

  if (typeof value.model === "string" && isRuntimeOnlyStepRepr(value.model)) {
    return null;
  }

  if ("model" in value) {
    const model = value.model;
    const modelRecord = isRecord(model) ? model : null;
    const label = modelRecord
      ? toLabel(modelRecord.function || modelRecord.class, "Model")
      : toLabel(model, "Model");

    return toPreviewStep(state, {
      type: "model",
      name: label,
      params: modelRecord ? toParams(modelRecord.params) : {},
      generator: toGenerator(value),
    });
  }

  if ("y_processing" in value) {
    const yProcessing = value.y_processing;
    const yRecord = isRecord(yProcessing) ? yProcessing : null;
    return toPreviewStep(state, {
      type: "y_processing",
      name: toLabel(yRecord?.class || yProcessing, "Y Processing"),
      params: yRecord ? toParams(yRecord.params) : {},
    });
  }

  if ("split" in value) {
    const split = value.split;
    const splitRecord = isRecord(split) ? split : null;
    return toPreviewStep(state, {
      type: "split",
      name: toLabel(splitRecord?.class || split, "Split"),
      params: splitRecord ? toParams(splitRecord.params) : {},
    });
  }

  if ("class" in value) {
    return toPreviewStep(state, {
      type: "preprocessing",
      name: toLabel(value.class),
      params: toParams(value.params),
    });
  }

  if ("branch" in value) {
    const branches = Array.isArray(value.branch)
      ? value.branch
      : isRecord(value.branch)
      ? Object.values(value.branch)
      : [];

    return toPreviewStep(state, {
      type: "branch",
      name: "Branch",
      params: {},
      branches: branches.map((branch) => toPreviewSteps(branch, state)),
    });
  }

  if ("merge" in value) {
    return toPreviewStep(state, {
      type: "merge",
      name: "Merge",
      params: isRecord(value.merge)
        ? toParams(value.merge)
        : value.merge !== undefined
        ? { strategy: clonePreviewValue(value.merge) }
        : {},
    });
  }

  if ("sample_augmentation" in value) {
    const config = isRecord(value.sample_augmentation) ? value.sample_augmentation : {};
    return toPreviewStep(state, {
      type: "flow",
      name: "Sample Augmentation",
      params: pickParams(config, ["count", "selection", "random_state", "variation_scope"]),
      children: toPreviewSteps(config.transformers || [], state),
    });
  }

  if ("feature_augmentation" in value) {
    const config = value.feature_augmentation;
    if (Array.isArray(config)) {
      return toPreviewStep(state, {
        type: "flow",
        name: "Feature Augmentation",
        params: pickParams(value, ["action"]),
        children: toPreviewSteps(config, state),
      });
    }

    if (isRecord(config) && Array.isArray(config._or_)) {
      return toPreviewStep(state, {
        type: "flow",
        name: "Feature Augmentation",
        params: pickParams(value, ["action", "pick", "count"]),
        branches: config._or_.map((option) => toPreviewSteps(option, state)),
        generator: {
          _or_: clonePreviewValue(config._or_) as unknown[],
          count: typeof config.count === "number" ? config.count : undefined,
        },
      });
    }
  }

  if ("sample_filter" in value) {
    const config = isRecord(value.sample_filter) ? value.sample_filter : {};
    return toPreviewStep(state, {
      type: "flow",
      name: "Sample Filter",
      params: pickParams(config, ["mode", "report"]),
      children: toPreviewSteps(config.filters || [], state),
    });
  }

  if ("exclude" in value || "tag" in value) {
    const key = "exclude" in value ? "exclude" : "tag";
    return toPreviewStep(state, {
      type: "flow",
      name: key === "exclude" ? "Exclude" : "Tag",
      params: pickParams(value, ["mode"]),
      children: toPreviewSteps(value[key], state),
    });
  }

  if ("concat_transform" in value) {
    const transforms = Array.isArray(value.concat_transform) ? value.concat_transform : [];
    return toPreviewStep(state, {
      type: "preprocessing",
      name: "Concat Transform",
      params: {},
      branches: transforms.map((transform) => toPreviewSteps(transform, state)),
    });
  }

  if (Array.isArray(value._or_)) {
    return toPreviewStep(state, {
      type: "flow",
      name: "Or",
      params: pickParams(value, ["count", "pick", "arrange", "then_pick", "then_arrange", "_seed_"]),
      branches: value._or_.map((option) => toPreviewSteps(option, state)),
      generator: toGenerator(value),
    });
  }

  if (Array.isArray(value._cartesian_)) {
    return toPreviewStep(state, {
      type: "flow",
      name: "Cartesian",
      params: pickParams(value, ["count", "pick", "arrange", "_seed_"]),
      branches: value._cartesian_.map((stage) => toPreviewSteps(stage, state)),
      generator: toGenerator(value),
    });
  }

  if (Array.isArray(value._range_) || Array.isArray(value._log_range_)) {
    return toPreviewStep(state, {
      type: "flow",
      name: Array.isArray(value._log_range_) ? "Log Range" : "Range",
      params: pickParams(value, ["param", "count", "_seed_"]),
      generator: toGenerator(value),
    });
  }

  if (isRecord(value._grid_)) {
    const grid = Object.fromEntries(
      Object.entries(value._grid_).map(([paramName, values]) => [
        paramName,
        Array.isArray(values) ? clonePreviewValue(values) : [],
      ])
    ) as Record<string, unknown[]>;
    const useBranches = Object.values(grid).every(
      (values) => values.length > 0 && values.every((item) => isCanonicalStepLike(item))
    );

    return toPreviewStep(state, {
      type: "flow",
      name: "Grid",
      params: useBranches ? pickParams(value, ["count", "_seed_"]) : { ...pickParams(value, ["count", "_seed_"]), ...grid },
      branches: useBranches
        ? Object.values(grid).map((branch) => toPreviewSteps(branch, state))
        : undefined,
      generator: toGenerator({ ...value, _grid_: grid }),
    });
  }

  if (isRecord(value._zip_)) {
    const zip = Object.fromEntries(
      Object.entries(value._zip_).map(([paramName, values]) => [
        paramName,
        Array.isArray(values) ? clonePreviewValue(values) : [],
      ])
    ) as Record<string, unknown[]>;
    const useBranches = Object.values(zip).every(
      (values) => values.length > 0 && values.every((item) => isCanonicalStepLike(item))
    );

    return toPreviewStep(state, {
      type: "flow",
      name: "Zip",
      params: useBranches ? pickParams(value, ["count", "_seed_"]) : { ...pickParams(value, ["count", "_seed_"]), ...zip },
      branches: useBranches
        ? Object.values(zip).map((branch) => toPreviewSteps(branch, state))
        : undefined,
      generator: toGenerator({ ...value, _zip_: zip }),
    });
  }

  if (Array.isArray(value._chain_)) {
    return toPreviewStep(state, {
      type: "flow",
      name: "Chain",
      params: pickParams(value, ["count", "_seed_"]),
      branches: value._chain_.map((config) => toPreviewSteps(config, state)),
      generator: toGenerator(value),
    });
  }

  if (isRecord(value._sample_)) {
    const sample = toParams(value._sample_);
    const count = typeof sample.num === "number"
      ? sample.num
      : typeof value.count === "number"
      ? value.count
      : undefined;

    return toPreviewStep(state, {
      type: "flow",
      name: "Sample",
      params: { ...pickParams(value, ["_seed_"]), ...sample },
      generator: count ? { count } : undefined,
    });
  }

  if ("chart_2d" in value || "chart_y" in value) {
    const chartType = "chart_2d" in value ? "chart_2d" : "chart_y";
    return toPreviewStep(state, {
      type: "utility",
      name: chartType,
      params: value[chartType] === true ? {} : toParams(value[chartType]),
    });
  }

  return toPreviewStep(state, {
    type: "preprocessing",
    name: toLabel(value.class || value.function || value.name, "Step"),
    params: toParams(value.params),
  });
}

export function buildCanonicalPreviewSteps(steps: unknown[] | null | undefined): CanonicalPreviewStep[] {
  if (!Array.isArray(steps)) return [];
  return toPreviewSteps(steps, { nextId: 0 });
}