/**
 * MergeRenderer - Merge step configuration renderer
 *
 * Specialized renderer for merge steps that includes:
 * - Merge tab with strategy selection and parameters
 * - Sources tab for advanced branch merge configuration
 * - Stacking tab for ensemble/meta-model configuration
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { useCallback, lazy, Suspense, useState } from "react";
import { GitBranch, GitMerge, Info, Layers, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type MergeConfig } from "../../types";
import { defaultStackingConfig } from "../../stackingConfig";
import { StepActions } from "./StepActions";
import type { ParameterRendererProps } from "./types";
import { useStepMetadataCatalog } from "../../shared/stepMetadata";
import { getMergeSourceState } from "./MergeRenderer.helpers";
import { SourcesTab } from "./MergeRenderer.sources";

// Lazy load heavy StackingPanel component
const StackingPanel = lazy(() =>
  import("../../StackingPanel").then((m) => ({ default: m.StackingPanel }))
);

/**
 * Loading skeleton for StackingPanel
 */
function StackingPanelSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

/**
 * MergeRenderer - Tabbed configuration for merge steps
 *
 * Three tabs:
 * 1. Merge - Strategy selection and basic parameters
 * 2. Sources - Advanced branch merge configuration
 * 3. Stacking - Ensemble/meta-model setup
 */
export function MergeRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  renderParamInput,
  handleNameChange,
  handleResetParams,
  currentOption,
}: ParameterRendererProps) {
  const [activeTab, setActiveTab] = useState("merge");
  const { getStepOptions } = useStepMetadataCatalog();

  // Initialize stacking config if not present
  const stackingConfig = step.stackingConfig ?? defaultStackingConfig();

  // Initialize mergeConfig if not present
  const mergeConfig = step.mergeConfig ?? { mode: "predictions" };

  const handleStackingChange = useCallback(
    (newConfig: typeof stackingConfig) => {
      onUpdate(step.id, {
        stackingConfig: newConfig,
      });
    },
    [onUpdate, step.id]
  );

  const handleMergeConfigChange = useCallback(
    (newConfig: MergeConfig) => {
      onUpdate(step.id, {
        mergeConfig: newConfig,
      });
    },
    [onUpdate, step.id]
  );

  const hasStackingEnabled = stackingConfig?.enabled ?? false;
  const { advancedConfigCount, hasAdvancedConfig } = getMergeSourceState(mergeConfig);
  const mergeOptions = getStepOptions("flow").filter((opt) => opt.category === "Merging");

  return (
    <>
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="border-b border-border px-2">
          <TabsList className="h-10 w-full justify-start bg-transparent gap-1">
            <TabsTrigger
              value="merge"
              className="text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <GitMerge className="h-3.5 w-3.5 mr-1.5" />
              Merge
            </TabsTrigger>
            <TabsTrigger
              value="sources"
              className={`text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none ${
                hasAdvancedConfig
                  ? "text-blue-500 data-[state=active]:text-blue-600"
                  : ""
              }`}
            >
              <GitBranch className="h-3.5 w-3.5 mr-1.5" />
              Sources
              {hasAdvancedConfig && (
                <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-blue-500">
                  {advancedConfigCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="stacking"
              className={`text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none ${
                hasStackingEnabled
                  ? "text-pink-500 data-[state=active]:text-pink-600"
                  : ""
              }`}
            >
              <Layers className="h-3.5 w-3.5 mr-1.5" />
              Stacking
              {hasStackingEnabled && (
                <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-pink-500">
                  ON
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Merge Configuration Tab */}
        <TabsContent value="merge" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-6">
              {/* Merge Strategy Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Merge Strategy</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-[200px]">
                      <p>How to combine outputs from multiple branches</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select value={step.name} onValueChange={handleNameChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover max-h-[300px]">
                    {mergeOptions.map((opt) => (
                      <SelectItem key={opt.name} value={opt.name}>
                        <div className="flex flex-col">
                          <span className="font-medium">{opt.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {opt.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentOption && (
                  <p className="text-xs text-muted-foreground">
                    {currentOption.description}
                  </p>
                )}
              </div>

              <Separator />

              {/* Parameters */}
              {Object.keys(step.params).length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Parameters</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={handleResetParams}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                  </div>
                  {Object.entries(step.params).map(([key, value]) =>
                    renderParamInput(key, value)
                  )}
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="p-3 rounded-full bg-muted/50 w-fit mx-auto mb-3">
                    <Info className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    No configurable parameters
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This merge strategy uses default settings
                  </p>
                </div>
              )}

              {/* Stacking CTA */}
              {!hasStackingEnabled && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-pink-500/5 border border-pink-500/20">
                  <Layers className="h-4 w-4 text-pink-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-foreground">
                      Want to use stacking ensemble?
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Combine branch predictions with a meta-model for better
                      results.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-pink-500/50 text-pink-500 hover:bg-pink-500/10"
                    onClick={() => setActiveTab("stacking")}
                  >
                    Configure
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Sources Tab - Advanced branch merge configuration */}
        <TabsContent value="sources" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <SourcesTab
              mergeConfig={mergeConfig}
              onConfigChange={handleMergeConfigChange}
            />
          </ScrollArea>
        </TabsContent>

        {/* Stacking Tab */}
        <TabsContent value="stacking" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-4">
              <Suspense fallback={<StackingPanelSkeleton />}>
                <StackingPanel
                  config={stackingConfig}
                  onChange={handleStackingChange}
                />
              </Suspense>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <StepActions
        stepId={step.id}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </>
  );
}
