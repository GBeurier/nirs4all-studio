/**
 * Developer Quick Start Card - Synthetic Dataset Generation
 *
 * A dashboard card that allows developers to quickly generate synthetic
 * datasets for testing and development purposes.
 *
 * Phase 6 Implementation
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  FlaskConical,
  Sparkles,
  TrendingUp,
  GitBranch,
  Layers,
  Cpu,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Activity,
  BarChart3,
  Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  generateSyntheticDataset,
  getSyntheticPresets,
} from "@/api/client";
import type {
  GenerateSyntheticRequest,
  SyntheticPreset,
} from "@/types/settings";
import { DEFAULT_SYNTHETIC_CONFIG } from "@/types/settings";

const presetIcons: Record<string, LucideIcon> = {
  activity: Activity,
  "trending-up": TrendingUp,
  "bar-chart-3": BarChart3,
  "git-branch": GitBranch,
  layers: Layers,
  cpu: Cpu,
};

function PresetIcon({ icon }: { icon: string }) {
  const IconComponent = presetIcons[icon] ?? Activity;
  return <IconComponent className="h-4 w-4" />;
}

interface DeveloperQuickStartProps {
  onDatasetGenerated?: (datasetId: string | undefined) => void;
}

export function DeveloperQuickStart({ onDatasetGenerated }: DeveloperQuickStartProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [config, setConfig] = useState<GenerateSyntheticRequest>({
    ...DEFAULT_SYNTHETIC_CONFIG,
  });

  const queryClient = useQueryClient();

  // Fetch presets
  const { data: presetsData } = useQuery({
    queryKey: ["synthetic-presets"],
    queryFn: getSyntheticPresets,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const presets = presetsData?.presets ?? [];

  // Generate mutation
  const generateMutation = useMutation({
    mutationFn: generateSyntheticDataset,
    onSuccess: (data) => {
      // Invalidate datasets query to refresh the list
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onDatasetGenerated?.(data.dataset_id ?? undefined);
    },
  });

  const handlePresetClick = (preset: SyntheticPreset) => {
    setSelectedPreset(preset.id);
    setConfig((prev) => ({
      ...prev,
      task_type: preset.task_type,
      n_samples: preset.n_samples,
      complexity: preset.complexity,
      n_classes: preset.task_type === "multiclass_classification" ? 3 : 2,
    }));
  };

  const handleGenerate = () => {
    generateMutation.mutate(config);
  };

  const handleCustomGenerate = () => {
    setSelectedPreset(null);
    setShowAdvanced(true);
  };

  const isGenerating = generateMutation.isPending;
  const isSuccess = generateMutation.isSuccess;
  const isError = generateMutation.isError;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FlaskConical className="h-5 w-5 text-primary" />
          Developer Quick Start
          <Badge variant="outline" className="ml-2 text-xs">
            Dev Mode
          </Badge>
        </CardTitle>
        <CardDescription>
          Generate synthetic datasets for testing and development
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Presets Grid */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
            Quick Presets
          </Label>
          <div className="grid grid-cols-2 gap-2">
            {presets.slice(0, 4).map((preset) => (
              <TooltipProvider key={preset.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={selectedPreset === preset.id ? "default" : "outline"}
                      size="sm"
                      className="h-auto py-2 px-3 justify-start"
                      onClick={() => handlePresetClick(preset)}
                      disabled={isGenerating}
                    >
                      <PresetIcon icon={preset.icon} />
                      <span className="ml-2 text-xs truncate">{preset.name}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{preset.description}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>

        {/* Custom Option */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center text-muted-foreground hover:text-foreground"
          onClick={handleCustomGenerate}
        >
          <Settings2 className="h-4 w-4 mr-2" />
          Custom Configuration...
        </Button>

        {/* Advanced Options (Collapsible) */}
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between p-0 h-auto hover:bg-transparent"
            >
              <span className="text-xs text-muted-foreground">
                Advanced Options
              </span>
              {showAdvanced ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4"
              >
                {/* Task Type */}
                <div className="space-y-2">
                  <Label className="text-xs">Task Type</Label>
                  <Select
                    value={config.task_type}
                    onValueChange={(v) =>
                      setConfig((prev) => ({
                        ...prev,
                        task_type: v as GenerateSyntheticRequest["task_type"],
                      }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regression">Regression</SelectItem>
                      <SelectItem value="binary_classification">
                        Binary Classification
                      </SelectItem>
                      <SelectItem value="multiclass_classification">
                        Multiclass Classification
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Number of Samples */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs">Samples</Label>
                    <span className="text-xs text-muted-foreground">
                      {config.n_samples}
                    </span>
                  </div>
                  <Slider
                    value={[config.n_samples]}
                    onValueChange={([v]) =>
                      setConfig((prev) => ({ ...prev, n_samples: v }))
                    }
                    min={100}
                    max={5000}
                    step={100}
                    className="py-2"
                  />
                </div>

                {/* Complexity */}
                <div className="space-y-2">
                  <Label className="text-xs">Complexity</Label>
                  <Select
                    value={config.complexity}
                    onValueChange={(v) =>
                      setConfig((prev) => ({
                        ...prev,
                        complexity: v as GenerateSyntheticRequest["complexity"],
                      }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">Simple (fast)</SelectItem>
                      <SelectItem value="realistic">Realistic</SelectItem>
                      <SelectItem value="complex">Complex (challenging)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Classes (for classification) */}
                {config.task_type !== "regression" && (
                  <div className="space-y-2">
                    <Label className="text-xs">Number of Classes</Label>
                    <Input
                      type="number"
                      min={2}
                      max={20}
                      value={config.n_classes ?? 3}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          n_classes: parseInt(e.target.value) || 3,
                        }))
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                )}

                {/* Noise Level */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs">Noise Level</Label>
                    <span className="text-xs text-muted-foreground">
                      {((config.noise_level ?? 0.05) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <Slider
                    value={[(config.noise_level ?? 0.05) * 100]}
                    onValueChange={([v]) =>
                      setConfig((prev) => ({ ...prev, noise_level: v / 100 }))
                    }
                    min={0}
                    max={50}
                    step={5}
                    className="py-2"
                  />
                </div>

                {/* Toggles */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Include Metadata</Label>
                    <Switch
                      checked={config.include_metadata ?? true}
                      onCheckedChange={(v) =>
                        setConfig((prev) => ({ ...prev, include_metadata: v }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Add Batch Effects</Label>
                    <Switch
                      checked={config.add_batch_effects ?? false}
                      onCheckedChange={(v) =>
                        setConfig((prev) => ({ ...prev, add_batch_effects: v }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Auto-link to Workspace</Label>
                    <Switch
                      checked={config.auto_link ?? true}
                      onCheckedChange={(v) =>
                        setConfig((prev) => ({ ...prev, auto_link: v }))
                      }
                    />
                  </div>
                </div>

                {/* Custom Name */}
                <div className="space-y-2">
                  <Label className="text-xs">Dataset Name (optional)</Label>
                  <Input
                    placeholder="Auto-generated if empty"
                    value={config.name ?? ""}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        name: e.target.value || undefined,
                      }))
                    }
                    className="h-8 text-xs"
                  />
                </div>
              </motion.div>
            </AnimatePresence>
          </CollapsibleContent>
        </Collapsible>

        {/* Generate Button */}
        <Button
          className="w-full"
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate & Load
            </>
          )}
        </Button>

        {/* Status Messages */}
        <AnimatePresence mode="wait">
          {isSuccess && generateMutation.data && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span className="truncate">
                Created: {generateMutation.data.name}
              </span>
            </motion.div>
          )}
          {isError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 text-sm text-destructive"
            >
              <AlertCircle className="h-4 w-4" />
              <span>
                {(generateMutation.error as Error)?.message ||
                  "Generation failed"}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

export default DeveloperQuickStart;
