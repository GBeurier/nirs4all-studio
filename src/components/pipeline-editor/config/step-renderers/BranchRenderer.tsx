import { useEffect, useMemo, useState } from "react";
import { GitBranch, GitFork, Route } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StepActions } from "./StepActions";
import type {
  BranchMetadata,
  PipelineStep,
  SeparationBranchConfig,
  SeparationKind,
} from "../../types";
import type { StepRendererProps } from "./types";

function buildBranchName(
  branchMode: PipelineStep["branchMode"],
  config: SeparationBranchConfig | undefined,
): string {
  if (branchMode !== "separation") {
    return "ParallelBranch";
  }

  switch (config?.kind) {
    case "by_tag":
      return config.key ? `Branch by tag: ${config.key}` : "Branch by tag";
    case "by_metadata":
      return config.key ? `Branch by metadata: ${config.key}` : "Branch by metadata";
    case "by_source":
      return "Branch by source";
    default:
      return "Branch by filter";
  }
}

function parseRouteValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return value;
}

export function BranchRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
}: StepRendererProps) {
  const branchMode = step.branchMode ?? "duplication";
  const separationConfig = useMemo<SeparationBranchConfig>(
    () => ({
      kind: "by_tag",
      ...(step.separationConfig ?? {}),
    }),
    [step.separationConfig],
  );
  const branchMetadata = (step.branchMetadata ?? []) as BranchMetadata[];
  const [filterText, setFilterText] = useState(
    separationConfig.filter ? JSON.stringify(separationConfig.filter, null, 2) : "",
  );

  useEffect(() => {
    setFilterText(
      separationConfig.filter ? JSON.stringify(separationConfig.filter, null, 2) : "",
    );
  }, [separationConfig.filter]);

  const updateBranchStep = (updates: Partial<PipelineStep>) => {
    onUpdate(step.id, updates);
  };

  const updateSeparation = (updates: Partial<SeparationBranchConfig>) => {
    const nextConfig: SeparationBranchConfig = { ...separationConfig, ...updates };
    updateBranchStep({
      branchMode: "separation",
      separationConfig: nextConfig,
      name: buildBranchName("separation", nextConfig),
    });
  };

  const updateBranchMetadata = (index: number, updates: Partial<BranchMetadata>) => {
    const nextMetadata = branchMetadata.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, ...updates } : entry,
    );
    updateBranchStep({ branchMetadata: nextMetadata });
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div
            className={`flex items-center gap-3 rounded-lg border p-3 ${
              branchMode === "separation"
                ? "border-cyan-500/30 bg-cyan-500/10"
                : "border-cyan-500/20 bg-cyan-500/5"
            }`}
          >
            {branchMode === "separation" ? (
              <Route className="h-5 w-5 text-cyan-500" />
            ) : (
              <GitFork className="h-5 w-5 text-cyan-500" />
            )}
            <div>
              <h4 className="text-sm font-medium">
                {branchMode === "separation" ? "Separation Branch" : "Parallel Branch"}
              </h4>
              <p className="text-xs text-muted-foreground">
                {branchMode === "separation"
                  ? "Route different samples to different branches."
                  : "Duplicate the same samples across multiple branches."}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Branch Mode</Label>
            <Select
              value={branchMode}
              onValueChange={(value) => {
                const nextMode = value as PipelineStep["branchMode"];
                updateBranchStep({
                  branchMode: nextMode,
                  name: buildBranchName(nextMode, separationConfig),
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="duplication">Duplication</SelectItem>
                <SelectItem value="separation">Separation</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {branchMode === "separation" && (
            <>
              <Separator />

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Routing Strategy</Label>
                  <Select
                    value={separationConfig.kind}
                    onValueChange={(value) => {
                      updateSeparation({ kind: value as SeparationKind });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      <SelectItem value="by_tag">By Tag</SelectItem>
                      <SelectItem value="by_metadata">By Metadata</SelectItem>
                      <SelectItem value="by_filter">By Filter</SelectItem>
                      <SelectItem value="by_source">By Source</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(separationConfig.kind === "by_tag" ||
                  separationConfig.kind === "by_metadata") && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      {separationConfig.kind === "by_tag" ? "Tag Name" : "Metadata Column"}
                    </Label>
                    <Input
                      value={separationConfig.key ?? ""}
                      onChange={(event) =>
                        updateSeparation({ key: event.target.value || undefined })
                      }
                      placeholder={
                        separationConfig.kind === "by_tag"
                          ? "e.g. y_outlier_iqr"
                          : "e.g. instrument"
                      }
                    />
                  </div>
                )}

                {separationConfig.kind === "by_filter" && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Filter Payload</Label>
                    <Textarea
                      value={filterText}
                      onChange={(event) => setFilterText(event.target.value)}
                      onBlur={() => {
                        const trimmed = filterText.trim();
                        if (!trimmed) {
                          updateSeparation({ filter: undefined });
                          return;
                        }
                        try {
                          updateSeparation({ filter: JSON.parse(trimmed) });
                        } catch {
                          setFilterText(
                            separationConfig.filter
                              ? JSON.stringify(separationConfig.filter, null, 2)
                              : "",
                          );
                        }
                      }}
                      rows={6}
                      className="font-mono text-xs"
                      placeholder='{"class":"nirs4all.operators.filters.y_outlier.YOutlierFilter","params":{"method":"iqr"}}'
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter canonical JSON for the filter used to split pass/fail samples.
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between rounded-lg border border-dashed p-3">
                  <div>
                    <Label className="text-sm font-medium">Shared Steps</Label>
                    <p className="text-xs text-muted-foreground">
                      Use one shared branch pipeline for all routed values.
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(separationConfig.sharedSteps)}
                    onCheckedChange={(checked) => updateSeparation({ sharedSteps: checked })}
                  />
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-cyan-500" />
              <Label className="text-sm font-medium">
                {branchMode === "separation" ? "Route Values" : "Branch Labels"}
              </Label>
            </div>

            {branchMetadata.length > 0 ? (
              <div className="space-y-2">
                {branchMetadata.map((entry, index) => (
                  <div key={`${step.id}-branch-meta-${index}`} className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {branchMode === "separation" ? `Route ${index + 1}` : `Branch ${index + 1}`}
                    </Label>
                    <Input
                      value={String(entry.name ?? "")}
                      onChange={(event) => {
                        const nextName = event.target.value;
                        if (branchMode === "separation") {
                          updateBranchMetadata(index, {
                            name: nextName,
                            value: parseRouteValue(nextName),
                          });
                        } else {
                          updateBranchMetadata(index, { name: nextName });
                        }
                      }}
                      placeholder={
                        branchMode === "separation"
                          ? "e.g. True, portable, fail"
                          : `Branch ${index + 1}`
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Add branches in the tree to configure labels here.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Edit branch contents directly in the pipeline tree. This panel controls routing metadata only.
            </p>
          </div>
        </div>
      </ScrollArea>

      <StepActions stepId={step.id} onDuplicate={onDuplicate} onRemove={onRemove} />
    </>
  );
}
