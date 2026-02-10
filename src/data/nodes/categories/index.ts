/**
 * Category Index
 * Exports all category configurations
 */

import preprocessingCategory from './preprocessing.json';
import splittingCategory from './splitting.json';
import modelsCategory from './models.json';
import type { CategoryConfig, NodeType, FlowSubType, UtilitySubType, ColorScheme } from '../types';

// Type the imported JSON
const categories: CategoryConfig[] = [
  preprocessingCategory as CategoryConfig,
  splittingCategory as CategoryConfig,
  modelsCategory as CategoryConfig,
  // Additional categories with inline definitions for simpler ones
  {
    type: "y_processing",
    label: "Target Processing",
    description: "Target variable scaling and transformation",
    icon: "BarChart3",
    color: {
      border: "border-amber-500/30",
      bg: "bg-amber-500/5",
      hover: "hover:bg-amber-500/10 hover:border-amber-500/50",
      selected: "bg-amber-500/10 border-amber-500/100",
      text: "text-amber-500",
      active: "ring-amber-500 border-amber-500",
      gradient: "from-amber-500/20 to-amber-500/5"
    },
    defaultOpen: false,
    displayOrder: 2,
    subcategories: [
      { id: "scaling", label: "Scaling", displayOrder: 1 },
      { id: "transform", label: "Transform", displayOrder: 2 },
      { id: "discretization", label: "Discretization", displayOrder: 3 }
    ]
  },
  {
    type: "filter",
    label: "Filters",
    description: "Sample filtering and outlier removal",
    icon: "Filter",
    color: {
      border: "border-rose-500/30",
      bg: "bg-rose-500/5",
      hover: "hover:bg-rose-500/10 hover:border-rose-500/50",
      selected: "bg-rose-500/10 border-rose-500/100",
      text: "text-rose-500",
      active: "ring-rose-500 border-rose-500",
      gradient: "from-rose-500/20 to-rose-500/5"
    },
    defaultOpen: false,
    displayOrder: 5,
    subcategories: [
      { id: "sample", label: "Sample", displayOrder: 1 },
      { id: "outlier", label: "Outlier", displayOrder: 2 },
      { id: "quality", label: "Quality", displayOrder: 3 }
    ]
  },
  {
    type: "augmentation",
    label: "Augmentation",
    description: "Training-time data augmentation",
    icon: "Zap",
    color: {
      border: "border-indigo-500/30",
      bg: "bg-indigo-500/5",
      hover: "hover:bg-indigo-500/10 hover:border-indigo-500/50",
      selected: "bg-indigo-500/10 border-indigo-500/100",
      text: "text-indigo-500",
      active: "ring-indigo-500 border-indigo-500",
      gradient: "from-indigo-500/20 to-indigo-500/5"
    },
    defaultOpen: false,
    displayOrder: 6,
    subcategories: [
      { id: "noise", label: "Noise", displayOrder: 1 },
      { id: "drift", label: "Drift", displayOrder: 2 },
      { id: "shift", label: "Shift", displayOrder: 3 },
      { id: "masking", label: "Masking", displayOrder: 4 },
      { id: "mixing", label: "Mixing", displayOrder: 5 },
      { id: "transform", label: "Transform", displayOrder: 6 }
    ]
  },
  {
    type: "flow",
    label: "Flow Control",
    description: "Pipeline flow control: branching, merging, containers, generators",
    icon: "GitBranch",
    color: {
      border: "border-cyan-500/30",
      bg: "bg-cyan-500/5",
      hover: "hover:bg-cyan-500/10 hover:border-cyan-500/50",
      selected: "bg-cyan-500/10 border-cyan-500/100",
      text: "text-cyan-500",
      active: "ring-cyan-500 border-cyan-500",
      gradient: "from-cyan-500/20 to-cyan-500/5"
    },
    defaultOpen: false,
    displayOrder: 7,
    subcategories: [
      { id: "branching", label: "Branching", displayOrder: 1 },
      { id: "merging", label: "Merging", displayOrder: 2 },
      { id: "generators", label: "Generators", displayOrder: 3 },
      { id: "augmentation-containers", label: "Augmentation Containers", displayOrder: 4 },
      { id: "filter-containers", label: "Filter Containers", displayOrder: 5 },
      { id: "feature-concatenation", label: "Feature Concatenation", displayOrder: 6 },
      { id: "sequential", label: "Sequential", displayOrder: 7 }
    ]
  },
  {
    type: "utility",
    label: "Utility",
    description: "Visualization, documentation, and non-executing steps",
    icon: "Settings",
    color: {
      border: "border-gray-500/30",
      bg: "bg-gray-500/5",
      hover: "hover:bg-gray-500/10 hover:border-gray-500/50",
      selected: "bg-gray-500/10 border-gray-500/100",
      text: "text-gray-500",
      active: "ring-gray-500 border-gray-500",
      gradient: "from-gray-500/20 to-gray-500/5"
    },
    defaultOpen: false,
    displayOrder: 8,
    subcategories: [
      { id: "visualization", label: "Visualization", displayOrder: 1 },
      { id: "documentation", label: "Documentation", displayOrder: 2 }
    ]
  }
];

// ============================================================================
// Color scheme lookup by subType (for flow/utility nodes that need distinct colors)
// ============================================================================

/**
 * Color schemes for flow sub-types.
 * Flow nodes share the main "flow" category but may be rendered with
 * sub-type-specific colors for visual distinction.
 */
const flowSubTypeColors: Record<FlowSubType, ColorScheme> = {
  branch: {
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/5",
    hover: "hover:bg-cyan-500/10 hover:border-cyan-500/50",
    selected: "bg-cyan-500/10 border-cyan-500/100",
    text: "text-cyan-500",
    active: "ring-cyan-500 border-cyan-500",
    gradient: "from-cyan-500/20 to-cyan-500/5"
  },
  merge: {
    border: "border-pink-500/30",
    bg: "bg-pink-500/5",
    hover: "hover:bg-pink-500/10 hover:border-pink-500/50",
    selected: "bg-pink-500/10 border-pink-500/100",
    text: "text-pink-500",
    active: "ring-pink-500 border-pink-500",
    gradient: "from-pink-500/20 to-pink-500/5"
  },
  generator: {
    border: "border-orange-500/30",
    bg: "bg-orange-500/5",
    hover: "hover:bg-orange-500/10 hover:border-orange-500/50",
    selected: "bg-orange-500/10 border-orange-500/100",
    text: "text-orange-500",
    active: "ring-orange-500 border-orange-500",
    gradient: "from-orange-500/20 to-orange-500/5"
  },
  sample_augmentation: {
    border: "border-violet-500/30",
    bg: "bg-violet-500/5",
    hover: "hover:bg-violet-500/10 hover:border-violet-500/50",
    selected: "bg-violet-500/10 border-violet-500/100",
    text: "text-violet-500",
    active: "ring-violet-500 border-violet-500",
    gradient: "from-violet-500/20 to-violet-500/5"
  },
  feature_augmentation: {
    border: "border-fuchsia-500/30",
    bg: "bg-fuchsia-500/5",
    hover: "hover:bg-fuchsia-500/10 hover:border-fuchsia-500/50",
    selected: "bg-fuchsia-500/10 border-fuchsia-500/100",
    text: "text-fuchsia-500",
    active: "ring-fuchsia-500 border-fuchsia-500",
    gradient: "from-fuchsia-500/20 to-fuchsia-500/5"
  },
  sample_filter: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    hover: "hover:bg-red-500/10 hover:border-red-500/50",
    selected: "bg-red-500/10 border-red-500/100",
    text: "text-red-500",
    active: "ring-red-500 border-red-500",
    gradient: "from-red-500/20 to-red-500/5"
  },
  concat_transform: {
    border: "border-teal-500/30",
    bg: "bg-teal-500/5",
    hover: "hover:bg-teal-500/10 hover:border-teal-500/50",
    selected: "bg-teal-500/10 border-teal-500/100",
    text: "text-teal-500",
    active: "ring-teal-500 border-teal-500",
    gradient: "from-teal-500/20 to-teal-500/5"
  },
  sequential: {
    border: "border-lime-500/30",
    bg: "bg-lime-500/5",
    hover: "hover:bg-lime-500/10 hover:border-lime-500/50",
    selected: "bg-lime-500/10 border-lime-500/100",
    text: "text-lime-500",
    active: "ring-lime-500 border-lime-500",
    gradient: "from-lime-500/20 to-lime-500/5"
  },
};

const utilitySubTypeColors: Record<UtilitySubType, ColorScheme> = {
  chart: {
    border: "border-sky-500/30",
    bg: "bg-sky-500/5",
    hover: "hover:bg-sky-500/10 hover:border-sky-500/50",
    selected: "bg-sky-500/10 border-sky-500/100",
    text: "text-sky-500",
    active: "ring-sky-500 border-sky-500",
    gradient: "from-sky-500/20 to-sky-500/5"
  },
  comment: {
    border: "border-gray-500/30",
    bg: "bg-gray-500/5",
    hover: "hover:bg-gray-500/10 hover:border-gray-500/50",
    selected: "bg-gray-500/10 border-gray-500/100",
    text: "text-gray-500",
    active: "ring-gray-500 border-gray-500",
    gradient: "from-gray-500/20 to-gray-500/5"
  },
};

/**
 * Get category configuration by node type.
 */
export function getCategoryConfig(type: NodeType): CategoryConfig | undefined {
  return categories.find(c => c.type === type);
}

/**
 * Get all category configurations sorted by display order.
 */
export function getAllCategories(): CategoryConfig[] {
  return [...categories].sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Get color scheme for a node type, with optional subType for finer distinction.
 */
export function getColorScheme(type: NodeType, subType?: FlowSubType | UtilitySubType): ColorScheme {
  // Check subType-specific colors first
  if (subType) {
    if (type === "flow" && subType in flowSubTypeColors) {
      return flowSubTypeColors[subType as FlowSubType];
    }
    if (type === "utility" && subType in utilitySubTypeColors) {
      return utilitySubTypeColors[subType as UtilitySubType];
    }
  }
  const category = getCategoryConfig(type);
  return category?.color ?? {
    border: "border-gray-500/30",
    bg: "bg-gray-500/5",
    text: "text-gray-500"
  };
}

/**
 * Get label for a node type.
 */
export function getCategoryLabel(type: NodeType): string {
  const category = getCategoryConfig(type);
  return category?.label ?? type;
}

/**
 * Get subcategories for a node type.
 */
export function getSubcategories(type: NodeType): CategoryConfig['subcategories'] {
  const category = getCategoryConfig(type);
  return category?.subcategories ?? [];
}

export { categories, flowSubTypeColors, utilitySubTypeColors };
export default categories;
