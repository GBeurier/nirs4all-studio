/**
 * Category Index
 * Exports all category configurations
 */

import preprocessingCategory from './preprocessing.json';
import splittingCategory from './splitting.json';
import modelsCategory from './models.json';
import type { CategoryConfig, NodeType, ColorScheme } from '../types';

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
    type: "generator",
    label: "Generators",
    description: "Step-level generators for pipeline variants",
    icon: "Sparkles",
    color: {
      border: "border-orange-500/30",
      bg: "bg-orange-500/5",
      hover: "hover:bg-orange-500/10 hover:border-orange-500/50",
      selected: "bg-orange-500/10 border-orange-500/100",
      text: "text-orange-500",
      active: "ring-orange-500 border-orange-500",
      gradient: "from-orange-500/20 to-orange-500/5"
    },
    defaultOpen: false,
    displayOrder: 5,
    subcategories: [
      { id: "selection", label: "Selection", displayOrder: 1 },
      { id: "combination", label: "Combination", displayOrder: 2 }
    ]
  },
  {
    type: "branch",
    label: "Branching",
    description: "Parallel pipeline execution paths",
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
    displayOrder: 6,
    subcategories: [
      { id: "parallel", label: "Parallel", displayOrder: 1 },
      { id: "multi_source", label: "Multi-Source", displayOrder: 2 }
    ]
  },
  {
    type: "merge",
    label: "Merge",
    description: "Combine branch outputs",
    icon: "GitMerge",
    color: {
      border: "border-pink-500/30",
      bg: "bg-pink-500/5",
      hover: "hover:bg-pink-500/10 hover:border-pink-500/50",
      selected: "bg-pink-500/10 border-pink-500/100",
      text: "text-pink-500",
      active: "ring-pink-500 border-pink-500",
      gradient: "from-pink-500/20 to-pink-500/5"
    },
    defaultOpen: false,
    displayOrder: 7,
    subcategories: [
      { id: "feature", label: "Feature", displayOrder: 1 },
      { id: "prediction", label: "Prediction", displayOrder: 2 }
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
    displayOrder: 8,
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
    displayOrder: 9,
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
    type: "sample_augmentation",
    label: "Sample Augmentation",
    description: "Container for sample-level augmentation",
    icon: "Zap",
    color: {
      border: "border-violet-500/30",
      bg: "bg-violet-500/5",
      hover: "hover:bg-violet-500/10 hover:border-violet-500/50",
      selected: "bg-violet-500/10 border-violet-500/100",
      text: "text-violet-500",
      active: "ring-violet-500 border-violet-500",
      gradient: "from-violet-500/20 to-violet-500/5"
    },
    defaultOpen: false,
    displayOrder: 10,
    subcategories: [
      { id: "composite", label: "Composite", displayOrder: 1 }
    ]
  },
  {
    type: "feature_augmentation",
    label: "Feature Augmentation",
    description: "Container for feature-level augmentation",
    icon: "Layers",
    color: {
      border: "border-fuchsia-500/30",
      bg: "bg-fuchsia-500/5",
      hover: "hover:bg-fuchsia-500/10 hover:border-fuchsia-500/50",
      selected: "bg-fuchsia-500/10 border-fuchsia-500/100",
      text: "text-fuchsia-500",
      active: "ring-fuchsia-500 border-fuchsia-500",
      gradient: "from-fuchsia-500/20 to-fuchsia-500/5"
    },
    defaultOpen: false,
    displayOrder: 11,
    subcategories: [
      { id: "composite", label: "Composite", displayOrder: 1 }
    ]
  },
  {
    type: "sample_filter",
    label: "Sample Filter",
    description: "Container for composite filters",
    icon: "Filter",
    color: {
      border: "border-red-500/30",
      bg: "bg-red-500/5",
      hover: "hover:bg-red-500/10 hover:border-red-500/50",
      selected: "bg-red-500/10 border-red-500/100",
      text: "text-red-500",
      active: "ring-red-500 border-red-500",
      gradient: "from-red-500/20 to-red-500/5"
    },
    defaultOpen: false,
    displayOrder: 12,
    subcategories: [
      { id: "composite", label: "Composite", displayOrder: 1 }
    ]
  },
  {
    type: "concat_transform",
    label: "Concat Transform",
    description: "Horizontal feature concatenation",
    icon: "Combine",
    color: {
      border: "border-teal-500/30",
      bg: "bg-teal-500/5",
      hover: "hover:bg-teal-500/10 hover:border-teal-500/50",
      selected: "bg-teal-500/10 border-teal-500/100",
      text: "text-teal-500",
      active: "ring-teal-500 border-teal-500",
      gradient: "from-teal-500/20 to-teal-500/5"
    },
    defaultOpen: false,
    displayOrder: 13,
    subcategories: [
      { id: "feature_fusion", label: "Feature Fusion", displayOrder: 1 }
    ]
  },
  {
    type: "chart",
    label: "Charts",
    description: "Visualization steps",
    icon: "LineChart",
    color: {
      border: "border-sky-500/30",
      bg: "bg-sky-500/5",
      hover: "hover:bg-sky-500/10 hover:border-sky-500/50",
      selected: "bg-sky-500/10 border-sky-500/100",
      text: "text-sky-500",
      active: "ring-sky-500 border-sky-500",
      gradient: "from-sky-500/20 to-sky-500/5"
    },
    defaultOpen: false,
    displayOrder: 14,
    subcategories: [
      { id: "visualization", label: "Visualization", displayOrder: 1 }
    ]
  },
  {
    type: "comment",
    label: "Comments",
    description: "Documentation and annotation steps",
    icon: "MessageSquare",
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
    displayOrder: 15,
    subcategories: [
      { id: "documentation", label: "Documentation", displayOrder: 1 }
    ]
  }
];

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
 * Get color scheme for a node type.
 */
export function getColorScheme(type: NodeType): ColorScheme {
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

export { categories };
export default categories;
