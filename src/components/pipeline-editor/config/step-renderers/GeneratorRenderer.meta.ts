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
  /** i18n key of the generator display name. */
  labelKey: string;
  keyword: string;
  icon: LucideIcon;
  /** i18n key of the one-line description. */
  descriptionKey: string;
  supportsPickArrange: boolean;
  supportsSecondOrder: boolean;
  /** Unit id resolved with `pipelineEditor.config.generator.unit.<id>` (plural-aware). */
  variantUnit: string;
  /** Unit id resolved with `pipelineEditor.config.generator.unit.<id>` (plural-aware). */
  branchUnit: string;
}

export const GENERATOR_KINDS: Record<string, GeneratorKindMeta> = {
  or: {
    labelKey: "pipelineEditor.config.generator.kind.or.label",
    keyword: "_or_",
    icon: Sparkles,
    descriptionKey: "pipelineEditor.config.generator.kind.or.description",
    supportsPickArrange: true,
    supportsSecondOrder: true,
    variantUnit: "variant",
    branchUnit: "option",
  },
  cartesian: {
    labelKey: "pipelineEditor.config.generator.kind.cartesian.label",
    keyword: "_cartesian_",
    icon: Layers,
    descriptionKey: "pipelineEditor.config.generator.kind.cartesian.description",
    supportsPickArrange: true,
    supportsSecondOrder: false,
    variantUnit: "combination",
    branchUnit: "stage",
  },
  grid: {
    labelKey: "pipelineEditor.config.generator.kind.grid.label",
    keyword: "_grid_",
    icon: Hash,
    descriptionKey: "pipelineEditor.config.generator.kind.grid.description",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantUnit: "combination",
    branchUnit: "param",
  },
  zip: {
    labelKey: "pipelineEditor.config.generator.kind.zip.label",
    keyword: "_zip_",
    icon: Link2,
    descriptionKey: "pipelineEditor.config.generator.kind.zip.description",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantUnit: "pair",
    branchUnit: "param",
  },
  chain: {
    labelKey: "pipelineEditor.config.generator.kind.chain.label",
    keyword: "_chain_",
    icon: ListOrdered,
    descriptionKey: "pipelineEditor.config.generator.kind.chain.description",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantUnit: "config",
    branchUnit: "config",
  },
  sample: {
    labelKey: "pipelineEditor.config.generator.kind.sample.label",
    keyword: "_sample_",
    icon: BarChart3,
    descriptionKey: "pipelineEditor.config.generator.kind.sample.description",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantUnit: "sample",
    branchUnit: "sample",
  },
  range: {
    labelKey: "pipelineEditor.config.generator.kind.range.label",
    keyword: "_range_",
    icon: Ruler,
    descriptionKey: "pipelineEditor.config.generator.kind.range.description",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantUnit: "value",
    branchUnit: "value",
  },
  log_range: {
    labelKey: "pipelineEditor.config.generator.kind.log_range.label",
    keyword: "_log_range_",
    icon: GitBranch,
    descriptionKey: "pipelineEditor.config.generator.kind.log_range.description",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantUnit: "value",
    branchUnit: "value",
  },
};

export function getKindMeta(kind: string): GeneratorKindMeta {
  return GENERATOR_KINDS[kind] ?? GENERATOR_KINDS.or;
}

export const PRIMARY_MODE_OPTIONS: {
  value: PrimarySelectionMode;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
}[] = [
  { value: "none", labelKey: "pipelineEditor.config.generator.mode.none.label", descriptionKey: "pipelineEditor.config.generator.mode.none.description", icon: Sparkles },
  { value: "pick", labelKey: "pipelineEditor.config.generator.mode.pick.label", descriptionKey: "pipelineEditor.config.generator.mode.pick.description", icon: Layers },
  { value: "arrange", labelKey: "pipelineEditor.config.generator.mode.arrange.label", descriptionKey: "pipelineEditor.config.generator.mode.arrange.description", icon: Shuffle },
];

export const SECONDARY_MODE_OPTIONS: {
  value: SecondarySelectionMode;
  labelKey: string;
  descriptionKey: string;
}[] = [
  { value: "none", labelKey: "pipelineEditor.config.generator.secondMode.none.label", descriptionKey: "pipelineEditor.config.generator.secondMode.none.description" },
  { value: "then_pick", labelKey: "pipelineEditor.config.generator.secondMode.then_pick.label", descriptionKey: "pipelineEditor.config.generator.secondMode.then_pick.description" },
  { value: "then_arrange", labelKey: "pipelineEditor.config.generator.secondMode.then_arrange.label", descriptionKey: "pipelineEditor.config.generator.secondMode.then_arrange.description" },
];
