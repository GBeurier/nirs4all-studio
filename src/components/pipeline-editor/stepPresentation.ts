import type {
  PipelineStep,
  StepSubType,
  StepType,
} from "./types";

export const stepTypeLabels: Record<StepType, string> = {
  preprocessing: "Preprocessing",
  y_processing: "Target Processing",
  splitting: "Splitting",
  model: "Models",
  filter: "Filters",
  augmentation: "Augmentation",
  flow: "Flow Control",
  utility: "Utility",
};

export const stepSubTypeLabels: Record<StepSubType, string> = {
  branch: "Branching",
  merge: "Merge",
  generator: "Generators",
  sample_augmentation: "Sample Augmentation",
  feature_augmentation: "Feature Augmentation",
  sample_filter: "Sample Filter",
  concat_transform: "Concat Transform",
  sequential: "Sequential Group",
  chart: "Charts",
  comment: "Comments",
};

export interface StepColorScheme {
  border: string;
  bg: string;
  hover: string;
  selected: string;
  text: string;
  active: string;
  gradient: string;
}

export const stepColors: Record<StepType, StepColorScheme> = {
  preprocessing: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    hover: "hover:bg-blue-500/10 hover:border-blue-500/50",
    selected: "bg-blue-500/10 border-blue-500/100",
    text: "text-blue-500",
    active: "ring-blue-500 border-blue-500",
    gradient: "from-blue-500/20 to-blue-500/5",
  },
  y_processing: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    hover: "hover:bg-amber-500/10 hover:border-amber-500/50",
    selected: "bg-amber-500/10 border-amber-500/100",
    text: "text-amber-500",
    active: "ring-amber-500 border-amber-500",
    gradient: "from-amber-500/20 to-amber-500/5",
  },
  splitting: {
    border: "border-purple-500/30",
    bg: "bg-purple-500/5",
    hover: "hover:bg-purple-500/10 hover:border-purple-500/50",
    selected: "bg-purple-500/10 border-purple-500/100",
    text: "text-purple-500",
    active: "ring-purple-500 border-purple-500",
    gradient: "from-purple-500/20 to-purple-500/5",
  },
  model: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    hover: "hover:bg-emerald-500/10 hover:border-emerald-500/50",
    selected: "bg-emerald-500/10 border-emerald-500/100",
    text: "text-emerald-500",
    active: "ring-emerald-500 border-emerald-500",
    gradient: "from-emerald-500/20 to-emerald-500/5",
  },
  filter: {
    border: "border-rose-500/30",
    bg: "bg-rose-500/5",
    hover: "hover:bg-rose-500/10 hover:border-rose-500/50",
    selected: "bg-rose-500/10 border-rose-500/100",
    text: "text-rose-500",
    active: "ring-rose-500 border-rose-500",
    gradient: "from-rose-500/20 to-rose-500/5",
  },
  augmentation: {
    border: "border-indigo-500/30",
    bg: "bg-indigo-500/5",
    hover: "hover:bg-indigo-500/10 hover:border-indigo-500/50",
    selected: "bg-indigo-500/10 border-indigo-500/100",
    text: "text-indigo-500",
    active: "ring-indigo-500 border-indigo-500",
    gradient: "from-indigo-500/20 to-indigo-500/5",
  },
  flow: {
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/5",
    hover: "hover:bg-cyan-500/10 hover:border-cyan-500/50",
    selected: "bg-cyan-500/10 border-cyan-500/100",
    text: "text-cyan-500",
    active: "ring-cyan-500 border-cyan-500",
    gradient: "from-cyan-500/20 to-cyan-500/5",
  },
  utility: {
    border: "border-gray-500/30",
    bg: "bg-gray-500/5",
    hover: "hover:bg-gray-500/10 hover:border-gray-500/50",
    selected: "bg-gray-500/10 border-gray-500/100",
    text: "text-gray-500",
    active: "ring-gray-500 border-gray-500",
    gradient: "from-gray-500/20 to-gray-500/5",
  },
};

export const stepSubTypeColors: Record<StepSubType, StepColorScheme> = {
  branch: {
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/5",
    hover: "hover:bg-cyan-500/10 hover:border-cyan-500/50",
    selected: "bg-cyan-500/10 border-cyan-500/100",
    text: "text-cyan-500",
    active: "ring-cyan-500 border-cyan-500",
    gradient: "from-cyan-500/20 to-cyan-500/5",
  },
  merge: {
    border: "border-pink-500/30",
    bg: "bg-pink-500/5",
    hover: "hover:bg-pink-500/10 hover:border-pink-500/50",
    selected: "bg-pink-500/10 border-pink-500/100",
    text: "text-pink-500",
    active: "ring-pink-500 border-pink-500",
    gradient: "from-pink-500/20 to-pink-500/5",
  },
  generator: {
    border: "border-orange-500/30",
    bg: "bg-orange-500/5",
    hover: "hover:bg-orange-500/10 hover:border-orange-500/50",
    selected: "bg-orange-500/10 border-orange-500/100",
    text: "text-orange-500",
    active: "ring-orange-500 border-orange-500",
    gradient: "from-orange-500/20 to-orange-500/5",
  },
  sample_augmentation: {
    border: "border-violet-500/30",
    bg: "bg-violet-500/5",
    hover: "hover:bg-violet-500/10 hover:border-violet-500/50",
    selected: "bg-violet-500/10 border-violet-500/100",
    text: "text-violet-500",
    active: "ring-violet-500 border-violet-500",
    gradient: "from-violet-500/20 to-violet-500/5",
  },
  feature_augmentation: {
    border: "border-fuchsia-500/30",
    bg: "bg-fuchsia-500/5",
    hover: "hover:bg-fuchsia-500/10 hover:border-fuchsia-500/50",
    selected: "bg-fuchsia-500/10 border-fuchsia-500/100",
    text: "text-fuchsia-500",
    active: "ring-fuchsia-500 border-fuchsia-500",
    gradient: "from-fuchsia-500/20 to-fuchsia-500/5",
  },
  sample_filter: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    hover: "hover:bg-red-500/10 hover:border-red-500/50",
    selected: "bg-red-500/10 border-red-500/100",
    text: "text-red-500",
    active: "ring-red-500 border-red-500",
    gradient: "from-red-500/20 to-red-500/5",
  },
  concat_transform: {
    border: "border-teal-500/30",
    bg: "bg-teal-500/5",
    hover: "hover:bg-teal-500/10 hover:border-teal-500/50",
    selected: "bg-teal-500/10 border-teal-500/100",
    text: "text-teal-500",
    active: "ring-teal-500 border-teal-500",
    gradient: "from-teal-500/20 to-teal-500/5",
  },
  sequential: {
    border: "border-lime-500/30",
    bg: "bg-lime-500/5",
    hover: "hover:bg-lime-500/10 hover:border-lime-500/50",
    selected: "bg-lime-500/10 border-lime-500/100",
    text: "text-lime-500",
    active: "ring-lime-500 border-lime-500",
    gradient: "from-lime-500/20 to-lime-500/5",
  },
  chart: {
    border: "border-sky-500/30",
    bg: "bg-sky-500/5",
    hover: "hover:bg-sky-500/10 hover:border-sky-500/50",
    selected: "bg-sky-500/10 border-sky-500/100",
    text: "text-sky-500",
    active: "ring-sky-500 border-sky-500",
    gradient: "from-sky-500/20 to-sky-500/5",
  },
  comment: {
    border: "border-gray-500/30",
    bg: "bg-gray-500/5",
    hover: "hover:bg-gray-500/10 hover:border-gray-500/50",
    selected: "bg-gray-500/10 border-gray-500/100",
    text: "text-gray-500",
    active: "ring-gray-500 border-gray-500",
    gradient: "from-gray-500/20 to-gray-500/5",
  },
};

export function getStepColor(step: PipelineStep): StepColorScheme {
  if (step.subType && step.subType in stepSubTypeColors) {
    return stepSubTypeColors[step.subType];
  }
  return stepColors[step.type];
}
