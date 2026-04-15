export interface PipelineStats {
  operators: number;
  models: number;
  branches: number;
  variants: number;
  hasGenerators: boolean;
}

// Structural shape shared by editor steps and saved-pipeline steps.
// Callers pass either PipelineStep type — we cast internally, so keep this loose.
export type StatsStep = {
  id: string;
  type: string;
  name?: string;
  displayName?: string;
};

type NestedStep = {
  id: string;
  type: string;
  name?: string;
  displayName?: string;
  generator?: {
    _or_?: unknown[];
    _range_?: [number, number, number?] | number[];
    _log_range_?: [number, number, number?] | number[];
    _grid_?: Record<string, unknown[]>;
    _zip_?: Record<string, unknown[]>;
    count?: number;
  };
  children?: NestedStep[];
  branches?: NestedStep[][];
};

const MODEL_TYPES = new Set(["model", "model_pls", "model_ensemble", "model_dl"]);
const IGNORED_TYPES = new Set<string>(["merge"]);

function countChoices(step: NestedStep): number {
  const g = step.generator;
  if (!g) return 1;
  if (Array.isArray(g._or_)) return Math.max(1, g._or_.length);
  if (g._range_) {
    const [start, end, step_ = 1] = g._range_ as [number, number, number?];
    const s = typeof step_ === "number" ? step_ : 1;
    if (s === 0) return 1;
    return Math.max(1, Math.floor((end - start) / s) + 1);
  }
  if (g._log_range_) {
    const [, , n = 5] = g._log_range_ as [number, number, number?];
    return Math.max(1, n);
  }
  if (g._grid_) {
    return Object.values(g._grid_ as Record<string, unknown[]>).reduce(
      (acc, arr) => acc * Math.max(1, Array.isArray(arr) ? arr.length : 1),
      1
    );
  }
  if (g._zip_) {
    const lens = Object.values(g._zip_ as Record<string, unknown[]>).map((arr) =>
      Array.isArray(arr) ? arr.length : 1
    );
    return Math.max(1, Math.min(...lens));
  }
  if (typeof g.count === "number" && g.count > 0) return g.count;
  return 1;
}

function walk(steps: readonly unknown[] | undefined, stats: PipelineStats): void {
  if (!steps) return;
  for (const raw of steps) {
    const step = raw as NestedStep;
    if (IGNORED_TYPES.has(step.type)) {
      if (step.children) walk(step.children, stats);
      continue;
    }

    if (step.type === "branch" || step.type === "choice") {
      stats.branches += 1;
    } else if (MODEL_TYPES.has(step.type)) {
      stats.models += 1;
      stats.operators += 1;
    } else {
      stats.operators += 1;
    }

    if (step.generator) {
      stats.hasGenerators = true;
      stats.variants *= countChoices(step);
    }

    if (step.children) walk(step.children, stats);
    if (step.branches) {
      for (const branch of step.branches) walk(branch, stats);
    }
  }
}

export function computePipelineStats(steps: readonly unknown[] | undefined): PipelineStats {
  const stats: PipelineStats = {
    operators: 0,
    models: 0,
    branches: 0,
    variants: 1,
    hasGenerators: false,
  };
  walk(steps, stats);
  return stats;
}

export interface PipelinePreviewNode {
  id: string;
  label: string;
  depth: number;
  kind: "step" | "branch" | "model";
  hasGenerator: boolean;
}

function buildPreview(
  steps: readonly unknown[] | undefined,
  depth: number,
  acc: PipelinePreviewNode[],
  limit: number
): boolean {
  if (!steps) return true;
  for (const raw of steps) {
    if (acc.length >= limit) return false;
    const step = raw as NestedStep;
    const label = step.displayName || step.name || step.type;
    const kind: PipelinePreviewNode["kind"] =
      step.type === "branch" || step.type === "choice"
        ? "branch"
        : MODEL_TYPES.has(step.type)
        ? "model"
        : "step";
    acc.push({
      id: step.id,
      label,
      depth,
      kind,
      hasGenerator: !!step.generator,
    });
    if (step.branches) {
      for (const branch of step.branches) {
        if (!buildPreview(branch, depth + 1, acc, limit)) return false;
      }
    }
    if (step.children) {
      if (!buildPreview(step.children, depth + 1, acc, limit)) return false;
    }
  }
  return true;
}

export function buildPipelinePreview(
  steps: readonly unknown[] | undefined,
  limit = 6
): { nodes: PipelinePreviewNode[]; totalSteps: number; truncated: boolean } {
  const nodes: PipelinePreviewNode[] = [];
  buildPreview(steps, 0, nodes, limit);
  const totalSteps = countAllSteps(steps);
  return { nodes, totalSteps, truncated: totalSteps > nodes.length };
}

function countAllSteps(steps: readonly unknown[] | undefined): number {
  if (!steps) return 0;
  let n = 0;
  for (const raw of steps) {
    const step = raw as NestedStep;
    n += 1;
    if (step.branches) for (const b of step.branches) n += countAllSteps(b);
    if (step.children) n += countAllSteps(step.children);
  }
  return n;
}
