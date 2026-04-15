import type {
  InlinePipelinePayload,
  OperatorAvailabilityResponse,
  PreflightIssue,
} from "@/api/client";
import type { PipelineStep } from "@/components/pipeline-editor/types";

export const OPERATOR_AVAILABILITY_CACHE_KEY = "pipelineEditor.operatorAvailability.v2";
export const OPERATOR_AVAILABILITY_INVALIDATED_EVENT = "pipeline-operator-availability-invalidated";

const BRANCH_CONTAINER_SUBTYPES = new Set(["branch", "generator"]);

export interface MissingOperatorDetails extends Record<string, string | null | undefined> {
  step_id?: string;
  step_name?: string;
  step_type?: string;
  class_path?: string;
  function_path?: string;
  pipeline_name?: string;
  pipeline_id?: string;
  error?: string;
}

export interface MissingOperatorIssue extends PreflightIssue {
  details?: MissingOperatorDetails;
}

interface MissingOperatorLookups {
  byStepId: Map<string, MissingOperatorIssue>;
  byClassPath: Map<string, MissingOperatorIssue>;
  byFunctionPath: Map<string, MissingOperatorIssue>;
  byTypeAndName: Map<string, MissingOperatorIssue>;
}

function normalizeTypeAndName(stepType?: string, stepName?: string): string | null {
  const normalizedType = stepType?.trim().toLowerCase();
  const normalizedName = stepName?.trim().toLowerCase();
  if (!normalizedType || !normalizedName) {
    return null;
  }
  return `${normalizedType}:${normalizedName}`;
}

function shallowEqualStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function readCachedOperatorAvailability(): OperatorAvailabilityResponse | null {
  try {
    const raw = localStorage.getItem(OPERATOR_AVAILABILITY_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as OperatorAvailabilityResponse;
    if (!parsed || !Array.isArray(parsed.unavailable)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedOperatorAvailability(payload: OperatorAvailabilityResponse): void {
  try {
    localStorage.setItem(OPERATOR_AVAILABILITY_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage write failures.
  }
}

export function clearCachedOperatorAvailability(): void {
  try {
    localStorage.removeItem(OPERATOR_AVAILABILITY_CACHE_KEY);
  } catch {
    // Ignore localStorage delete failures.
  }
}

export function dispatchOperatorAvailabilityInvalidated(): void {
  clearCachedOperatorAvailability();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPERATOR_AVAILABILITY_INVALIDATED_EVENT));
  }
}

export function filterMissingOperatorIssues(issues: PreflightIssue[]): MissingOperatorIssue[] {
  return issues.filter((issue): issue is MissingOperatorIssue => issue.type === "missing_module");
}

export function buildMissingOperatorLookups(issues: MissingOperatorIssue[]): MissingOperatorLookups {
  const byStepId = new Map<string, MissingOperatorIssue>();
  const byClassPath = new Map<string, MissingOperatorIssue>();
  const byFunctionPath = new Map<string, MissingOperatorIssue>();
  const byTypeAndName = new Map<string, MissingOperatorIssue>();

  for (const issue of issues) {
    const details = issue.details;
    if (!details) {
      continue;
    }

    if (details.step_id) {
      byStepId.set(details.step_id, issue);
    }
    if (details.class_path) {
      byClassPath.set(details.class_path, issue);
    }
    if (details.function_path) {
      byFunctionPath.set(details.function_path, issue);
    }

    const typeAndName = normalizeTypeAndName(details.step_type, details.step_name);
    if (typeAndName) {
      byTypeAndName.set(typeAndName, issue);
    }
  }

  return {
    byStepId,
    byClassPath,
    byFunctionPath,
    byTypeAndName,
  };
}

export function findMissingOperatorIssue(
  step: Pick<PipelineStep, "id" | "type" | "name" | "classPath" | "functionPath">,
  lookups: MissingOperatorLookups,
): MissingOperatorIssue | null {
  if (lookups.byStepId.has(step.id)) {
    return lookups.byStepId.get(step.id) ?? null;
  }
  if (step.functionPath && lookups.byFunctionPath.has(step.functionPath)) {
    return lookups.byFunctionPath.get(step.functionPath) ?? null;
  }
  if (step.classPath && lookups.byClassPath.has(step.classPath)) {
    return lookups.byClassPath.get(step.classPath) ?? null;
  }

  const typeAndName = normalizeTypeAndName(step.type, step.name);
  if (typeAndName && lookups.byTypeAndName.has(typeAndName)) {
    return lookups.byTypeAndName.get(typeAndName) ?? null;
  }

  return null;
}

function pruneStep(
  step: PipelineStep,
  lookups: MissingOperatorLookups,
  removedIssues: MissingOperatorIssue[],
): PipelineStep | null {
  const issue = findMissingOperatorIssue(step, lookups);
  if (issue) {
    removedIssues.push(issue);
    return null;
  }

  let nextStep: PipelineStep = step;
  let changed = false;

  if (Array.isArray(step.children)) {
    const nextChildren = step.children
      .map((child) => pruneStep(child, lookups, removedIssues))
      .filter((child): child is PipelineStep => child !== null);

    if (!shallowEqualStringArray(step.children.map((child) => child.id), nextChildren.map((child) => child.id))) {
      nextStep = { ...nextStep, children: nextChildren };
      changed = true;
    }

    if (nextChildren.length === 0 && step.type === "flow") {
      return null;
    }
  }

  if (Array.isArray(step.branches)) {
    const nextBranches = step.branches
      .map((branch) =>
        branch
          .map((child) => pruneStep(child, lookups, removedIssues))
          .filter((child): child is PipelineStep => child !== null),
      )
      .filter((branch) => branch.length > 0);

    const branchIdsChanged =
      step.branches.length !== nextBranches.length ||
      step.branches.some((branch, index) => {
        const nextBranch = nextBranches[index] ?? [];
        return !shallowEqualStringArray(branch.map((child) => child.id), nextBranch.map((child) => child.id));
      });

    if (branchIdsChanged) {
      nextStep = { ...nextStep, branches: nextBranches };
      changed = true;
    }

    const subType = typeof step.subType === "string" ? step.subType : "";
    const minimumBranchCount = BRANCH_CONTAINER_SUBTYPES.has(subType) ? 1 : 0;
    if (nextBranches.length <= minimumBranchCount) {
      return null;
    }
  }

  if (step.namedBranches && typeof step.namedBranches === "object") {
    const nextNamedBranches = Object.fromEntries(
      Object.entries(step.namedBranches)
        .map(([branchName, branch]) => [
          branchName,
          branch
            .map((child) => pruneStep(child, lookups, removedIssues))
            .filter((child): child is PipelineStep => child !== null),
        ])
        .filter(([, branch]) => branch.length > 0),
    );

    const currentBranchNames = Object.keys(step.namedBranches);
    const nextBranchNames = Object.keys(nextNamedBranches);
    if (!shallowEqualStringArray(currentBranchNames, nextBranchNames)) {
      nextStep = { ...nextStep, namedBranches: nextNamedBranches };
      changed = true;
    }

    if (nextBranchNames.length === 0) {
      return null;
    }
  }

  return changed ? nextStep : step;
}

export function pruneUnavailableSteps(
  steps: PipelineStep[],
  issues: MissingOperatorIssue[],
): { steps: PipelineStep[]; removedIssues: MissingOperatorIssue[] } {
  const lookups = buildMissingOperatorLookups(issues);
  const removedIssues: MissingOperatorIssue[] = [];
  const nextSteps = steps
    .map((step) => pruneStep(step, lookups, removedIssues))
    .filter((step): step is PipelineStep => step !== null);

  return {
    steps: nextSteps,
    removedIssues,
  };
}

export function toInlinePipelinePayload(
  name: string,
  steps: PipelineStep[],
): InlinePipelinePayload {
  return { name, steps };
}

export function groupMissingIssuesByPipeline(
  issues: MissingOperatorIssue[],
): Array<{ pipelineName: string; issues: MissingOperatorIssue[] }> {
  const grouped = new Map<string, MissingOperatorIssue[]>();

  for (const issue of issues) {
    const pipelineName = issue.details?.pipeline_name || "Current pipeline";
    const bucket = grouped.get(pipelineName) ?? [];
    bucket.push(issue);
    grouped.set(pipelineName, bucket);
  }

  return Array.from(grouped.entries()).map(([pipelineName, groupedIssues]) => ({
    pipelineName,
    issues: groupedIssues,
  }));
}
