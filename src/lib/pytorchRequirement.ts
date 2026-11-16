/**
 * Which pipeline operators need PyTorch, and when Studio can install it.
 *
 * The node registry is the only source: an operator needs PyTorch when its
 * definition declares `requires: ["torch"]`. Operators that declare another
 * package (TabPFN, TabICL) or none are not attributed to PyTorch here.
 */
import { allNodes } from "@/data/nodes";
import type { PythonEnvReport } from "@/types/pythonEnvironment";

/** Distribution name of PyTorch in the node registry and in the package catalogue. */
export const PYTORCH_PACKAGE = "torch";

/** What the user asked for that cannot run without PyTorch. */
export type PyTorchNeed =
  /** A neural-network model is being added to a pipeline. */
  | { kind: "model"; name: string }
  /** An experiment is being launched; `pipelines` names those that contain neural-network models. */
  | { kind: "experiment"; pipelines: readonly string[] };

/** True when PyTorch is the only optional package the operator declares. */
export function requiresPyTorch(requires: readonly string[] | undefined): boolean {
  return requires !== undefined && requires.length > 0 && requires.every((name) => name === PYTORCH_PACKAGE);
}

/** The PyTorch need of adding this operator to a pipeline, or null when it has none. */
export function pyTorchNeedOfOperator(operator: { name: string; requires?: readonly string[] }): PyTorchNeed | null {
  return requiresPyTorch(operator.requires) ? { kind: "model", name: operator.name } : null;
}

/**
 * Studio can add PyTorch to this environment: it may install packages there
 * and the package listing reports PyTorch missing.
 */
export function lacksInstallablePyTorch(report: PythonEnvReport | null | undefined): boolean {
  if (!report?.writable) return false;
  return report.recommended.some((pkg) => pkg.name === PYTORCH_PACKAGE && pkg.status === "missing");
}

function operatorKey(type: string, name: string): string {
  return `${type}:${name}`.toLowerCase();
}

const pyTorchNodes = allNodes.filter((node) => requiresPyTorch(node.requires));
const pyTorchPaths = new Set<unknown>(pyTorchNodes.flatMap((node) => [node.classPath, ...(node.legacyClassPaths ?? [])]));
const pyTorchNames = new Set(pyTorchNodes.map((node) => operatorKey(node.type, node.name)));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nestedSteps(step: Record<string, unknown>): unknown[] {
  const branches = Array.isArray(step.branches) ? step.branches : [];
  const namedBranches = isRecord(step.namedBranches) ? Object.values(step.namedBranches) : [];
  return [step.children, ...branches, ...namedBranches].flatMap((steps) => (Array.isArray(steps) ? steps : []));
}

/**
 * Whether an enabled step of an editor-format pipeline is a PyTorch operator.
 * A step is matched by its import path; one without a path by type and name.
 */
export function stepsNeedPyTorch(steps: readonly unknown[]): boolean {
  return steps.some((step) => {
    if (!isRecord(step) || step.enabled === false) return false;
    const path = [step.classPath, step.functionPath].find((value) => typeof value === "string");
    const isPyTorchStep = path !== undefined
      ? pyTorchPaths.has(path)
      : typeof step.type === "string" && typeof step.name === "string" && pyTorchNames.has(operatorKey(step.type, step.name));
    return isPyTorchStep || stepsNeedPyTorch(nestedSteps(step));
  });
}
