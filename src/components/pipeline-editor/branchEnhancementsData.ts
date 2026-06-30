import type { GeneratorKind, PipelineStep } from "./types";
import { calculateStepVariants } from "./variantCounting";

export type BranchEnhancementKind = "branch" | "generator";
export type BranchOutputType = "parallel" | "or" | "cartesian";
export type BranchOutputIcon = "layers" | "arrowRight" | "hash";

export interface BranchSummaryStats {
  branchCount: number;
  totalSteps: number;
  totalVariants: number;
  modelCount: number;
  emptyBranches: number;
}

export interface BranchOutputDescriptor {
  description: string;
  icon: BranchOutputIcon;
  colorClass: string;
}

export interface BranchVisualClasses {
  headerBackground: string;
  iconColor: string;
  containerBorderColor: string;
  addButtonColor: string;
}

export interface AddBranchButtonDescriptor {
  label: string;
  colorClass: string;
}

type BranchGeneratorKind = GeneratorKind | string | undefined;

export function getDefaultBranchName(
  type: BranchEnhancementKind,
  generatorKind?: BranchGeneratorKind,
  index = 0
): string {
  const idx = index + 1;
  if (type === "generator") {
    if (generatorKind === "cartesian") return `Stage ${idx}`;
    if (generatorKind === "grid" || generatorKind === "zip") return `Param ${idx}`;
    if (generatorKind === "chain") return `Config ${idx}`;
    return `Option ${idx}`;
  }
  return `Branch ${idx}`;
}

export function getBranchSummaryLabel(
  isGenerator: boolean,
  generatorKind?: BranchGeneratorKind
): string {
  if (!isGenerator) {
    return "branches";
  }

  if (generatorKind === "cartesian") return "stages";
  if (generatorKind === "grid" || generatorKind === "zip") return "params";
  if (generatorKind === "chain") return "configs";
  return "options";
}

export function getAddBranchLabel(
  isGenerator: boolean,
  generatorKind?: BranchGeneratorKind
): string {
  if (!isGenerator) {
    return "Add Branch";
  }

  if (generatorKind === "cartesian") return "Add Stage";
  if (generatorKind === "grid" || generatorKind === "zip") return "Add Param";
  if (generatorKind === "chain") return "Add Config";
  return "Add Option";
}

export function getBranchVisualClasses(isGenerator: boolean): BranchVisualClasses {
  if (isGenerator) {
    return {
      headerBackground: "bg-orange-500/5",
      iconColor: "text-orange-400",
      containerBorderColor: "border-orange-400/30",
      addButtonColor: "text-orange-500 hover:text-orange-600 hover:bg-orange-500/10",
    };
  }

  return {
    headerBackground: "bg-cyan-500/5",
    iconColor: "text-cyan-500",
    containerBorderColor: "border-cyan-500/30",
    addButtonColor: "text-cyan-500 hover:text-cyan-600 hover:bg-cyan-500/10",
  };
}

export function getAddBranchButtonDescriptor(
  isGenerator: boolean,
  generatorKind?: BranchGeneratorKind
): AddBranchButtonDescriptor {
  return {
    label: getAddBranchLabel(isGenerator, generatorKind),
    colorClass: getBranchVisualClasses(isGenerator).addButtonColor,
  };
}

export function calculateBranchVariantCount(branch: readonly PipelineStep[]): number {
  return branch.reduce((acc, step) => acc * calculateStepVariants(step), 1);
}

export function calculateBranchSummaryStats(
  branches: readonly (readonly PipelineStep[])[]
): BranchSummaryStats {
  const totalSteps = branches.reduce((sum, branch) => sum + branch.length, 0);
  const totalVariants = branches.reduce(
    (sum, branch) => sum + calculateBranchVariantCount(branch),
    0
  );
  const modelCount = branches.reduce(
    (sum, branch) => sum + branch.filter((step) => step.type === "model").length,
    0
  );
  const emptyBranches = branches.filter((branch) => branch.length === 0).length;

  return {
    branchCount: branches.length,
    totalSteps,
    totalVariants,
    modelCount,
    emptyBranches,
  };
}

export function getBranchOutputDescriptor(
  branchType: BranchOutputType,
  branchCount: number,
  modelCount: number
): BranchOutputDescriptor {
  switch (branchType) {
    case "parallel":
      return {
        description: modelCount > 0
          ? `${modelCount} parallel predictions → merge`
          : `${branchCount} parallel processings`,
        icon: "layers",
        colorClass: "text-cyan-500",
      };
    case "or":
      return {
        description: `1 of ${branchCount} alternatives`,
        icon: "arrowRight",
        colorClass: "text-orange-500",
      };
    case "cartesian":
      return {
        description: `${branchCount} stage combinations`,
        icon: "hash",
        colorClass: "text-orange-500",
      };
  }
}
