import {
  BarChart3,
  GitBranch,
  Hash,
  Layers,
  Link2,
  ListOrdered,
  Ruler,
  Shuffle,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type {
  PrimarySelectionMode,
  SecondarySelectionMode,
} from "./GeneratorRenderer.helpers";

export interface GeneratorKindMeta {
  label: string;
  keyword: string;
  icon: LucideIcon;
  description: string;
  supportsPickArrange: boolean;
  supportsSecondOrder: boolean;
  variantLabel: string;
  branchLabel: string;
}

export const GENERATOR_KINDS: Record<string, GeneratorKindMeta> = {
  or: {
    label: "Or (Choose)",
    keyword: "_or_",
    icon: Sparkles,
    description: "Choose from alternatives \u2014 each branch is one option",
    supportsPickArrange: true,
    supportsSecondOrder: true,
    variantLabel: "variant",
    branchLabel: "option",
  },
  cartesian: {
    label: "Cartesian Product",
    keyword: "_cartesian_",
    icon: Layers,
    description: "Cross all stages \u2014 each branch is a stage",
    supportsPickArrange: true,
    supportsSecondOrder: false,
    variantLabel: "combination",
    branchLabel: "stage",
  },
  grid: {
    label: "Grid Search",
    keyword: "_grid_",
    icon: Hash,
    description: "Cartesian product of parameter values",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "combination",
    branchLabel: "param",
  },
  zip: {
    label: "Zip",
    keyword: "_zip_",
    icon: Link2,
    description: "Pair parameter values by position",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "pair",
    branchLabel: "param",
  },
  chain: {
    label: "Chain",
    keyword: "_chain_",
    icon: ListOrdered,
    description: "Ordered sequence of configurations",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "config",
    branchLabel: "config",
  },
  sample: {
    label: "Sample",
    keyword: "_sample_",
    icon: BarChart3,
    description: "Random samples from a distribution",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "sample",
    branchLabel: "sample",
  },
  range: {
    label: "Range",
    keyword: "_range_",
    icon: Ruler,
    description: "Linear numeric sequence",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "value",
    branchLabel: "value",
  },
  log_range: {
    label: "Log Range",
    keyword: "_log_range_",
    icon: GitBranch,
    description: "Logarithmically-spaced values",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "value",
    branchLabel: "value",
  },
};

export function getKindMeta(kind: string): GeneratorKindMeta {
  return GENERATOR_KINDS[kind] ?? GENERATOR_KINDS.or;
}

export const PRIMARY_MODE_OPTIONS: {
  value: PrimarySelectionMode;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  { value: "none", label: "Try Each", description: "Test each option individually", icon: Sparkles },
  { value: "pick", label: "Pick", description: "Combinations (order ignored)", icon: Layers },
  { value: "arrange", label: "Arrange", description: "Permutations (order matters)", icon: Shuffle },
];

export const SECONDARY_MODE_OPTIONS: {
  value: SecondarySelectionMode;
  label: string;
  description: string;
}[] = [
  { value: "none", label: "None", description: "No second-order selection" },
  { value: "then_pick", label: "Then Pick", description: "Combinations from results" },
  { value: "then_arrange", label: "Then Arrange", description: "Permutations from results" },
];
