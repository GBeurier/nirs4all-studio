/**
 * Synthetic Data Generation Dialog
 *
 * A dialog component for generating synthetic NIRS datasets.
 * Provides both quick presets and detailed configuration options.
 *
 * Phase 4 Implementation - Developer Mode Feature
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
  Loader2,
  CheckCircle2,
  AlertCircle,
  Activity,
  BarChart3,
  Settings2,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
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

interface SyntheticDataDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  onDatasetGenerated?: (datasetId: string | undefined) => void;
}

export function SyntheticDataDialog({
  open,
  onOpenChange,
  trigger,
  onDatasetGenerated,
}: SyntheticDataDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setIsOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [activeTab, setActiveTab] = useState<"presets" | "custom">("presets");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [config, setConfig] = useState<GenerateSyntheticRequest>({
    ...DEFAULT_SYNTHETIC_CONFIG,
  });

  const queryClient = useQueryClient();

  // Fetch presets
  const { data: presetsData, isLoading: isLoadingPresets } = useQuery({
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

      // Close dialog after short delay to show success message
      setTimeout(() => {
        setIsOpen(false);
        // Reset state
        setSelectedPreset(null);
        setConfig({ ...DEFAULT_SYNTHETIC_CONFIG });
        setShowAdvanced(false);
        generateMutation.reset();
      }, 1500);
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

  const isGenerating = generateMutation.isPending;
  const isSuccess = generateMutation.isSuccess;
  const isError = generateMutation.isError;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Generate Synthetic Dataset
            <Badge variant="outline" className="ml-2">
              Dev Mode
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Create synthetic spectral data for testing and development purposes.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "presets" | "custom")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="presets">Quick Presets</TabsTrigger>
            <TabsTrigger value="custom">Custom Configuration</TabsTrigger>
          </TabsList>

          {/* Presets Tab */}
          <TabsContent value="presets" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select a preset configuration for quick dataset generation.
            </p>

            {isLoadingPresets ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {presets.map((preset) => (
                  <Card
                    key={preset.id}
                    className={`cursor-pointer transition-all hover:border-primary/50 ${
                      selectedPreset === preset.id
                        ? "border-primary bg-primary/5"
                        : ""
                    }`}
                    onClick={() => handlePresetClick(preset)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div
                          className={`p-2 rounded-lg ${
                            selectedPreset === preset.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <PresetIcon icon={preset.icon} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm">{preset.name}</h4>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {preset.description}
                          </p>
                          <div className="flex gap-2 mt-2">
                            <Badge variant="secondary" className="text-xs">
                              {preset.n_samples} samples
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {preset.complexity}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Quick options for preset */}
            {selectedPreset && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="space-y-4 pt-4 border-t"
              >
                <div className="grid grid-cols-2 gap-4">
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
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="auto-link-preset"
                        checked={config.auto_link ?? true}
                        onCheckedChange={(v) =>
                          setConfig((prev) => ({ ...prev, auto_link: v }))
                        }
                      />
                      <Label htmlFor="auto-link-preset" className="text-xs">
                        Auto-link to workspace
                      </Label>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </TabsContent>

          {/* Custom Tab */}
          <TabsContent value="custom" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Task Type */}
              <div className="space-y-2">
                <Label className="text-sm">Task Type</Label>
                <Select
                  value={config.task_type}
                  onValueChange={(v) =>
                    setConfig((prev) => ({
                      ...prev,
                      task_type: v as GenerateSyntheticRequest["task_type"],
                    }))
                  }
                >
                  <SelectTrigger>
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

              {/* Complexity */}
              <div className="space-y-2">
                <Label className="text-sm">Complexity</Label>
                <Select
                  value={config.complexity}
                  onValueChange={(v) =>
                    setConfig((prev) => ({
                      ...prev,
                      complexity: v as GenerateSyntheticRequest["complexity"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple">Simple (fast training)</SelectItem>
                    <SelectItem value="realistic">Realistic</SelectItem>
                    <SelectItem value="complex">Complex (challenging)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Number of Samples */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-sm">Number of Samples</Label>
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

              {/* Classes (for classification) */}
              {config.task_type !== "regression" && (
                <div className="space-y-2">
                  <Label className="text-sm">Number of Classes</Label>
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
                  />
                </div>
              )}

              {/* Train/Test Ratio */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-sm">Train Ratio</Label>
                  <span className="text-xs text-muted-foreground">
                    {((config.train_ratio ?? 0.8) * 100).toFixed(0)}%
                  </span>
                </div>
                <Slider
                  value={[(config.train_ratio ?? 0.8) * 100]}
                  onValueChange={([v]) =>
                    setConfig((prev) => ({ ...prev, train_ratio: v / 100 }))
                  }
                  min={50}
                  max={95}
                  step={5}
                  className="py-2"
                />
              </div>

              {/* Noise Level */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-sm">Noise Level</Label>
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
            </div>

            {/* Advanced Options */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Include Metadata</Label>
                      <p className="text-xs text-muted-foreground">
                        Add sample_id, batch columns
                      </p>
                    </div>
                    <Switch
                      checked={config.include_metadata ?? true}
                      onCheckedChange={(v) =>
                        setConfig((prev) => ({ ...prev, include_metadata: v }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Batch Effects</Label>
                      <p className="text-xs text-muted-foreground">
                        Simulate batch-to-batch variation
                      </p>
                    </div>
                    <Switch
                      checked={config.add_batch_effects ?? false}
                      onCheckedChange={(v) =>
                        setConfig((prev) => ({ ...prev, add_batch_effects: v }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Include Repetitions</Label>
                      <p className="text-xs text-muted-foreground">
                        Duplicate samples with variation
                      </p>
                    </div>
                    <Switch
                      checked={config.include_repetitions ?? false}
                      onCheckedChange={(v) =>
                        setConfig((prev) => ({ ...prev, include_repetitions: v }))
                      }
                    />
                  </div>

                  {config.include_repetitions && (
                    <div className="space-y-2">
                      <Label className="text-sm">Repetitions per Sample</Label>
                      <Input
                        type="number"
                        min={2}
                        max={10}
                        value={config.repetitions_per_sample ?? 3}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            repetitions_per_sample: parseInt(e.target.value) || 3,
                          }))
                        }
                      />
                    </div>
                  )}

                  {config.add_batch_effects && (
                    <div className="space-y-2">
                      <Label className="text-sm">Number of Batches</Label>
                      <Input
                        type="number"
                        min={2}
                        max={10}
                        value={config.n_batches ?? 3}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            n_batches: parseInt(e.target.value) || 3,
                          }))
                        }
                      />
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Name and Auto-link */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t">
              <div className="space-y-2">
                <Label className="text-sm">Dataset Name (optional)</Label>
                <Input
                  placeholder="Auto-generated if empty"
                  value={config.name ?? ""}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      name: e.target.value || undefined,
                    }))
                  }
                />
              </div>
              <div className="flex items-end">
                <div className="flex items-center gap-2">
                  <Switch
                    id="auto-link-custom"
                    checked={config.auto_link ?? true}
                    onCheckedChange={(v) =>
                      setConfig((prev) => ({ ...prev, auto_link: v }))
                    }
                  />
                  <Label htmlFor="auto-link-custom" className="text-sm">
                    Auto-link to workspace
                  </Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">
                          Automatically add the generated dataset to your workspace
                          for immediate use.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Status Messages */}
        <AnimatePresence mode="wait">
          {isSuccess && generateMutation.data && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400"
            >
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Dataset generated successfully!</p>
                <p className="text-xs truncate">{generateMutation.data.name}</p>
              </div>
            </motion.div>
          )}
          {isError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive"
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Generation failed</p>
                <p className="text-xs">
                  {(generateMutation.error as Error)?.message || "Unknown error"}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || (activeTab === "presets" && !selectedPreset)}
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Dataset
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SyntheticDataDialog;
