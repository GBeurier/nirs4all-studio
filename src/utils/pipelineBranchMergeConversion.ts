import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import { generateStepId } from "@/components/pipeline-editor/stepFactory";
import type {
  Nirs4allBranchStep,
  Nirs4allMergeStep,
  Nirs4allSeparationBranch,
  Nirs4allStep,
} from "./nirs4allPipelineTypes";

type Nirs4allToEditorStepConverter = (step: Nirs4allStep) => EditorPipelineStep;
type EditorToNirs4allStepConverter = (step: EditorPipelineStep) => Nirs4allStep;

function isSeparationBranch(
  branchData: Nirs4allBranchStep["branch"]
): branchData is Nirs4allSeparationBranch {
  return (
    !Array.isArray(branchData) &&
    typeof branchData === "object" &&
    branchData !== null &&
    "steps" in branchData &&
    ("by_tag" in branchData ||
      "by_metadata" in branchData ||
      "by_filter" in branchData ||
      "by_source" in branchData)
  );
}

export function convertBranchToEditor(
  step: Nirs4allBranchStep,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep {
  if (isSeparationBranch(step.branch)) {
    const branchData = step.branch;
    const name = "by_tag" in branchData
      ? `Branch by tag: ${branchData.by_tag}`
      : "by_metadata" in branchData
        ? `Branch by metadata: ${branchData.by_metadata}`
        : "by_source" in branchData
          ? "Branch by source"
          : "Branch by filter";

    return {
      id: generateStepId(),
      type: "flow",
      subType: "branch",
      name,
      params: {},
      branchMode: "separation",
      rawNirs4all: step,
    };
  }

  const branches: EditorPipelineStep[][] = [];
  const branchMetadata: Array<{ name?: string; isCollapsed?: boolean }> = [];
  const branchData = step.branch;

  if (Array.isArray(branchData)) {
    for (const branchSteps of branchData) {
      branches.push(branchSteps.map(child => convertStepToEditor(child)));
      branchMetadata.push({});
    }
  } else {
    for (const [branchName, branchSteps] of Object.entries(branchData)) {
      branches.push(branchSteps.map(child => convertStepToEditor(child)));
      branchMetadata.push({ name: branchName });
    }
  }

  return {
    id: generateStepId(),
    type: "flow",
    subType: "branch",
    name: "ParallelBranch",
    params: {},
    branches,
    branchMetadata,
    branchMode: "duplication",
  };
}

export function convertMergeToEditor(step: Nirs4allMergeStep): EditorPipelineStep {
  const merge = step.merge;

  if (typeof merge === "string") {
    return {
      id: generateStepId(),
      type: "flow",
      subType: "merge",
      name: merge === "predictions" ? "Stacking" : "Concatenate",
      params: { merge_type: merge },
      mergeConfig: {
        mode: merge,
      },
    };
  }

  if (merge.sources !== undefined) {
    return { id: generateStepId(), type: "flow", subType: "merge", name: "Concatenate", params: {},
      mergeConfig: { mode: "sources", sources: merge.sources,
        output_as: merge.output_as as "features" | "predictions" | undefined,
        on_missing: merge.on_missing as "warn" | "error" | "drop" | undefined } };
  }

  return {
    id: generateStepId(),
    type: "flow",
    subType: "merge",
    name: "Stacking",
    params: {},
    mergeConfig: {
      mode: "predictions",
      predictions: merge.predictions?.map(prediction => ({
        branch: prediction.branch,
        select: prediction.select as "best" | "all" | { top_k: number },
        metric: prediction.metric as "rmse" | "r2" | "mae" | undefined,
      })),
      features: merge.features,
      output_as: merge.output_as as "features" | "predictions" | undefined,
      on_missing: merge.on_missing as "warn" | "error" | "drop" | undefined,
    },
    stackingConfig: {
      enabled: true,
      metaModel: "",
      metaModelParams: {},
      sourceModels: [],
      coverageStrategy: "drop",
      useOriginalFeatures: !!merge.features?.length,
      passthrough: false,
    },
  };
}

export function convertEditorBranchToNirs4all(
  step: EditorPipelineStep,
  convertEditorStepToNirs4all: EditorToNirs4allStepConverter
): Nirs4allStep {
  if (step.classPath === "source_branch" || step.name === "SourceBranch") {
    const sources = step.params.sources;
    const branches = step.branches ?? [];
    if (!Array.isArray(sources) || !sources.length || sources.length !== branches.length) {
      throw new Error("SourceBranch requires one source name for each branch");
    }
    if (sources.some(name => typeof name !== "string" || !name.trim()) || new Set(sources).size !== sources.length) {
      throw new Error("SourceBranch source names must be nonempty and unique");
    }
    return { branch: { by_source: true, steps: Object.fromEntries(sources.map((name, index) =>
      [name, branches[index].map(convertEditorStepToNirs4all)])) } };
  }
  if (!step.branches || step.branches.length === 0) {
    return { branch: {} };
  }

  const hasNames = step.branchMetadata?.some(metadata => metadata.name);

  if (hasNames) {
    const namedBranches: Record<string, Nirs4allStep[]> = {};
    for (let index = 0; index < step.branches.length; index++) {
      const branchName = step.branchMetadata?.[index]?.name || `branch_${index}`;
      namedBranches[branchName] = step.branches[index].map(child =>
        convertEditorStepToNirs4all(child)
      );
    }
    return { branch: namedBranches };
  }

  const indexedBranches: Nirs4allStep[][] = step.branches.map(branch =>
    branch.map(child => convertEditorStepToNirs4all(child))
  );

  return { branch: indexedBranches };
}

export function convertEditorMergeToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  if (step.mergeConfig) {
    const config = step.mergeConfig;

    if (config.sources !== undefined || config.mode === "sources") {
      return { merge: { sources: config.sources ?? "concat",
        ...(config.output_as ? { output_as: config.output_as } : {}),
        ...(config.on_missing ? { on_missing: config.on_missing } : {}) } };
    }

    if (config.mode && !config.predictions && !config.features) {
      return { merge: config.mode };
    }

    const mergeConfig: Record<string, unknown> = {};
    if (config.predictions) {
      mergeConfig.predictions = config.predictions;
    }
    if (config.features) {
      mergeConfig.features = config.features;
    }
    if (config.output_as) {
      mergeConfig.output_as = config.output_as;
    }
    if (config.on_missing) {
      mergeConfig.on_missing = config.on_missing;
    }
    return { merge: mergeConfig as Nirs4allMergeStep["merge"] };
  }

  const params = step.params as Record<string, unknown>;

  if (step.classPath === "source_merge" || step.name === "MergeSources") {
    if ((params.axis ?? "features") !== "features") {
      throw new Error("MergeSources supports concatenating features of aligned samples only");
    }
    return { merge: { sources: "concat" } };
  }

  const mode = params.mode ?? params.merge_type;
  if (mode && !params.predictions) {
    if (!["predictions", "features", "all", "concat"].includes(String(mode))) {
      throw new Error(`Unsupported merge mode: ${String(mode)}`);
    }
    return { merge: mode as string };
  }

  const mergeConfig: Record<string, unknown> = {};
  for (const key of ["predictions", "features", "output_as", "on_missing"] as const) {
    if (params[key] !== undefined) {
      mergeConfig[key] = params[key];
    }
  }
  return { merge: mergeConfig as Nirs4allMergeStep["merge"] };
}
