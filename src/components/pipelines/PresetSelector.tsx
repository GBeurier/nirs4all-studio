/**
 * PresetSelector component for pipeline presets
 * Phase 6: Pipelines Library
 */

import { motion } from "@/lib/motion";
import { FlaskConical, Wheat, Calculator, GitBranch, Sparkles, Beaker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PipelinePreset } from "@/types/pipelines";

interface PresetSelectorProps {
  presets: PipelinePreset[];
  onSelect: (presetId: string) => void;
  loading?: boolean;
}

// Icon mapping for preset categories
const presetIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  pls_basic: Calculator,
  pls_derivative: GitBranch,
  rf_standard: Sparkles,
  kennard_stone_pls: FlaskConical,
  advanced_nirs: Beaker,
  food: Wheat,
  pharma: FlaskConical,
  default: GitBranch,
};

// Color mapping for categories
const categoryColors: Record<string, string> = {
  regression: "bg-primary/10 text-primary",
  classification: "bg-accent/10 text-accent",
  default: "bg-muted text-muted-foreground",
};

export function PresetSelector({ presets, onSelect, loading }: PresetSelectorProps) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
  };

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-4 bg-muted rounded w-2/3 mb-2" />
              <div className="h-3 bg-muted rounded w-full mb-3" />
              <div className="h-8 bg-muted rounded w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (presets.length === 0) {
    return (
      <Card className="p-6 text-center">
        <FlaskConical className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No preset pipelines available</p>
      </Card>
    );
  }

  return (
    <motion.div
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {presets.map((preset) => {
        const Icon = presetIcons[preset.id] || presetIcons.default;
        const colorClass = categoryColors[preset.taskType] || categoryColors.default;

        return (
          <motion.div key={preset.id} variants={itemVariants}>
            <Card className="step-card cursor-pointer h-full">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${colorClass}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="font-semibold text-foreground">{preset.name}</h3>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {preset.taskType}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                  {preset.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {preset.steps.length} steps
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelect(preset.id)}
                  >
                    Use Template
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// Inline presets for when the API is unavailable
export const defaultPresets: PipelinePreset[] = [
  {
    id: "pls_basic",
    name: "Basic PLS Pipeline",
    description: "Simple PLS regression with SNV preprocessing",
    category: "regression",
    taskType: "regression",
    steps: [
      { name: "StandardNormalVariate", type: "preprocessing", params: {} },
      { name: "KFold", type: "splitting", params: { n_splits: 5 } },
      { name: "PLSRegression", type: "model", params: { n_components: 10 } },
    ],
  },
  {
    id: "pls_derivative",
    name: "PLS with Derivative",
    description: "PLS regression with first derivative preprocessing",
    category: "regression",
    taskType: "regression",
    steps: [
      { name: "SavitzkyGolay", type: "preprocessing", params: { window_length: 11, polyorder: 2, deriv: 1 } },
      { name: "StandardNormalVariate", type: "preprocessing", params: {} },
      { name: "KFold", type: "splitting", params: { n_splits: 5 } },
      { name: "PLSRegression", type: "model", params: { n_components: 15 } },
    ],
  },
  {
    id: "rf_standard",
    name: "Random Forest Pipeline",
    description: "Random Forest with standard preprocessing",
    category: "regression",
    taskType: "regression",
    steps: [
      { name: "StandardScaler", type: "preprocessing", params: {} },
      { name: "KFold", type: "splitting", params: { n_splits: 5 } },
      { name: "RandomForestRegressor", type: "model", params: { n_estimators: 100 } },
    ],
  },
  {
    id: "kennard_stone_pls",
    name: "Kennard-Stone PLS",
    description: "PLS with Kennard-Stone sample selection for optimal coverage",
    category: "regression",
    taskType: "regression",
    steps: [
      { name: "MultiplicativeScatterCorrection", type: "preprocessing", params: {} },
      { name: "KennardStoneSplitter", type: "splitting", params: { test_size: 0.2 } },
      { name: "PLSRegression", type: "model", params: { n_components: 10 } },
    ],
  },
  {
    id: "advanced_nirs",
    name: "Advanced NIRS Pipeline",
    description: "Comprehensive NIRS preprocessing with baseline correction and OPLS",
    category: "regression",
    taskType: "regression",
    steps: [
      { name: "ASLSBaseline", type: "preprocessing", params: { lam: 1e6, p: 0.01 } },
      { name: "StandardNormalVariate", type: "preprocessing", params: {} },
      { name: "SavitzkyGolay", type: "preprocessing", params: { window_length: 15, polyorder: 2, deriv: 1 } },
      { name: "SPXYGFold", type: "splitting", params: { n_splits: 5 } },
      { name: "OPLS", type: "model", params: { n_components: 10 } },
    ],
  },
  {
    id: "food_analysis",
    name: "Food Analysis",
    description: "Optimized for NIR protein and nutrient content prediction",
    category: "food",
    taskType: "regression",
    steps: [
      { name: "StandardNormalVariate", type: "preprocessing", params: {} },
      { name: "SavitzkyGolay", type: "preprocessing", params: { window_length: 11, polyorder: 2, deriv: 1 } },
      { name: "KBinsStratifiedSplitter", type: "splitting", params: { test_size: 0.2, n_bins: 10 } },
      { name: "PLSRegression", type: "model", params: { n_components: 12 } },
    ],
  },
];
