import {
  BarChart3,
  Filter,
  GitBranch,
  Shuffle,
  Sparkles,
  Target,
  Waves,
  Zap,
} from "lucide-react";
import type { StepType } from "./types";

export const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  y_processing: BarChart3,
  splitting: Shuffle,
  model: Target,
  filter: Filter,
  augmentation: Zap,
  flow: GitBranch,
  utility: Sparkles,
};
