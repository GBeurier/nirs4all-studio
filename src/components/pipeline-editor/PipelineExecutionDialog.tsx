/**
 * PipelineExecutionDialog - Execute pipeline with real-time progress tracking.
 *
 * Phase 6 Implementation:
 * - Dataset selection
 * - Real-time progress via WebSocket
 * - Result visualization
 * - Export options (Python, YAML, JSON)
 *
 * Run A Enhancement:
 * - Quick Run option that navigates to /runs/{id} for progress tracking
 * - Persisted runs with model export
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play } from "lucide-react";
import { toast } from "sonner";

import { MissingNodesConfirmDialog } from "./MissingNodesConfirmDialog";
import {
  usePipelineExecution,
  useDatasetSelection,
} from "@/hooks/usePipelineExecution";
import { getPipeline } from "@/api/pipelines";
import { quickRun, runPreflight } from "@/api/runs";
import type { PipelineStep as EditorPipelineStep } from "./types";
import {
  analyzeSelectedPipelinesRuntimeGrouping,
  evaluateDatasetRuntimeGrouping,
  RUNTIME_GROUPING_COPY,
} from "@/lib/runtimeSplitGrouping";
import {
  pruneUnavailableSteps,
  resolvePreflightIssues,
  type MissingOperatorIssue,
} from "@/lib/pipelineOperatorAvailability";
import {
  buildDefaultRunName,
  buildInlinePipeline,
  buildPipelineExecutionCampaignSpec,
  buildPipelineExecutionPlanPreview,
  buildRuntimeGroupingDatasetPayload,
  buildSplitGroupByByDataset,
  canLaunchPipelineExecution,
  derivePipelineExecutionViewState,
  ensureDatasetGroupByEntry,
  getLaunchRunName,
  getPipelineExecutionSplitGroupBy,
} from "./pipelineExecutionDialogData";
import {
  ConnectionIndicator,
  DatasetSelector,
  ExecutionActions,
  ExecutionFeedback,
  ExecutionPlanPreview,
  ExportPanel,
  RunNameField,
  RuntimeGroupingConflictNotice,
  RuntimeGroupingSection,
  RuntimeGroupingStatusMessage,
  StatusBadge,
  type PipelineLaunchMode,
} from "./PipelineExecutionDialogSections";
import { RuntimeBackendSelector } from "@/components/runtime/RuntimeBackendSelector";
import { useRuntimeBackendPreference } from "@/lib/runtimeBackendPreference";

// ============================================================================
// Types
// ============================================================================

export interface PipelineExecutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
  variantCount?: number;
  pipelineSteps?: EditorPipelineStep[];
}

type InlinePipelinePayload = { name: string; steps: unknown[] };

// ============================================================================
// Main Component
// ============================================================================

export function PipelineExecutionDialog({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
  variantCount,
  pipelineSteps,
}: PipelineExecutionDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [runName, setRunName] = useState<string>(buildDefaultRunName(pipelineName));
  const [activeTab, setActiveTab] = useState<"execute" | "export">("execute");
  const [isQuickRunning, setIsQuickRunning] = useState(false);
  const [splitGroupByByDataset, setSplitGroupByByDataset] = useState<Record<string, string | null>>({});
  const [showMissingNodesDialog, setShowMissingNodesDialog] = useState(false);
  const [pendingMissingIssues, setPendingMissingIssues] = useState<MissingOperatorIssue[]>([]);
  const [pendingLaunchMode, setPendingLaunchMode] = useState<PipelineLaunchMode | null>(null);
  const [pendingPrunedInlinePipeline, setPendingPrunedInlinePipeline] = useState<InlinePipelinePayload | null>(null);
  const {
    runtimeEngine,
    allowFallback,
    setRuntimeEngine,
    setAllowFallback,
  } = useRuntimeBackendPreference();

  // Hooks
  const { datasets, isLoading: isLoadingDatasets } = useDatasetSelection();
  const { data: pipelineData, isLoading: isLoadingPipeline } = useQuery({
    queryKey: ["pipeline", pipelineId],
    queryFn: () => getPipeline(pipelineId),
    enabled: open && !pipelineSteps,
  });
  const {
    status,
    jobId,
    isConnected,
    progress,
    progressMessage,
    result,
    error,
    execute,
    cancel,
    reset,
  } = usePipelineExecution();

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      reset();
      setRunName(buildDefaultRunName(pipelineName));
      setActiveTab("execute");
      setIsQuickRunning(false);
      setSplitGroupByByDataset({});
      setShowMissingNodesDialog(false);
      setPendingMissingIssues([]);
      setPendingLaunchMode(null);
      setPendingPrunedInlinePipeline(null);
    }
  }, [open, reset, pipelineName]);

  const effectivePipelineName = pipelineData?.name || pipelineName;
  const effectivePipelineSteps = useMemo(
    () => pipelineSteps ?? (pipelineData?.steps as EditorPipelineStep[] | undefined),
    [pipelineData?.steps, pipelineSteps],
  );

  const groupingSelection = useMemo(
    () =>
      analyzeSelectedPipelinesRuntimeGrouping(
        effectivePipelineSteps
          ? [{ id: pipelineId, name: effectivePipelineName, steps: effectivePipelineSteps }]
          : [],
      ),
    [effectivePipelineName, effectivePipelineSteps, pipelineId],
  );

  const selectedDatasetInfo = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDataset) ?? null,
    [datasets, selectedDataset],
  );

  const selectedDatasetGroupingState = useMemo(() => {
    if (!selectedDatasetInfo) {
      return null;
    }

    return evaluateDatasetRuntimeGrouping(
      buildRuntimeGroupingDatasetPayload(selectedDatasetInfo),
      groupingSelection,
      splitGroupByByDataset[selectedDatasetInfo.id] ?? null,
    );
  }, [groupingSelection, selectedDatasetInfo, splitGroupByByDataset]);

  const selectedExecutionCampaign = useMemo(
    () =>
      buildPipelineExecutionCampaignSpec({
        name: getLaunchRunName(runName, pipelineName),
        datasetId: selectedDataset,
        datasetName: selectedDatasetInfo?.name,
        pipelineId,
        pipelineName: effectivePipelineName,
        steps: effectivePipelineSteps,
        selectedGroupBy: selectedDatasetGroupingState?.selectedGroupBy,
      }),
    [
      effectivePipelineName,
      effectivePipelineSteps,
      pipelineId,
      pipelineName,
      runName,
      selectedDataset,
      selectedDatasetGroupingState?.selectedGroupBy,
      selectedDatasetInfo?.name,
    ],
  );

  const selectedExecutionPlanPreview = useMemo(
    () => buildPipelineExecutionPlanPreview(selectedExecutionCampaign),
    [selectedExecutionCampaign],
  );

  const selectedExecutionSplitGroupBy = getPipelineExecutionSplitGroupBy(selectedExecutionCampaign) ??
    selectedDatasetGroupingState?.selectedGroupBy;

  const canRun = canLaunchPipelineExecution({
    selectedDataset,
    isLoadingPipeline,
    hasPersistedGroupConflict: groupingSelection.hasPersistedGroupConflict,
    hasBlockingGroupingError: selectedDatasetGroupingState?.hasBlockingError,
  });

  const resolveInlinePipeline = useCallback(
    (stepsOverride?: unknown[]) => {
      const stepsToUse = stepsOverride ?? effectivePipelineSteps;
      return buildInlinePipeline(effectivePipelineName, stepsToUse);
    },
    [effectivePipelineName, effectivePipelineSteps],
  );

  const executeLaunchMode = useCallback(async (
    mode: PipelineLaunchMode,
    inlinePipeline?: InlinePipelinePayload,
  ) => {
    if (!selectedDataset) {
      return;
    }

    if (mode === "execute") {
      await execute({
        pipelineId,
        datasetId: selectedDataset,
        exportModel: true,
        splitGroupByByDataset: buildSplitGroupByByDataset(
          selectedDataset,
          selectedExecutionSplitGroupBy,
        ),
        inlinePipeline,
        runtimeEngine,
        allowFallback,
      });
      return;
    }

    setIsQuickRunning(true);
    try {
      const run = await quickRun({
        pipeline_id: pipelineId,
        dataset_id: selectedDataset,
        name: getLaunchRunName(runName, pipelineName),
        export_model: true,
        cv_folds: 5,
        split_group_by_by_dataset: buildSplitGroupByByDataset(
          selectedDataset,
          selectedExecutionSplitGroupBy,
        ),
        inline_pipeline: inlinePipeline,
        engine: runtimeEngine,
        allow_fallback: allowFallback,
      });

      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["run-stats"] });

      if (mode === "quick") {
        toast.success("Run started! Redirecting to progress page...");
        onOpenChange(false);
        navigate(`/runs/${run.id}`);
        return;
      }

      toast.success(
        <div className="flex flex-col gap-1">
          <span>Run started in background!</span>
          <button
            onClick={() => navigate(`/runs/${run.id}`)}
            className="text-xs text-primary underline text-left"
          >
            View Progress →
          </button>
        </div>,
        { duration: 5000 }
      );
      onOpenChange(false);
    } catch {
      toast.error("Failed to start run");
    } finally {
      setIsQuickRunning(false);
    }
  }, [
    execute,
    navigate,
    onOpenChange,
    pipelineId,
    pipelineName,
    queryClient,
    runName,
    runtimeEngine,
    allowFallback,
    selectedDataset,
    selectedExecutionSplitGroupBy,
  ]);

  const handleLaunch = async (mode: PipelineLaunchMode) => {
    if (!selectedDataset) {
      toast.error("Please select a dataset");
      return;
    }
    if (groupingSelection.hasPersistedGroupConflict) {
      toast.error(RUNTIME_GROUPING_COPY.conflictToast);
      return;
    }
    if (selectedDatasetGroupingState?.hasBlockingError) {
      toast.error(selectedDatasetGroupingState.blockingMessage || "Runtime grouping is required for this dataset.");
      return;
    }

    // Preflight check
    try {
      const inlinePipeline = resolveInlinePipeline();
      const preflight = await runPreflight(
        inlinePipeline ? [] : [pipelineId],
        inlinePipeline,
      );
      if (!preflight.ready) {
        const preflightResolution = resolvePreflightIssues(preflight);

        if (preflightResolution.status === "blocking") {
          toast.error("Cannot start run", { description: preflightResolution.message });
          return;
        }

        if (preflightResolution.status === "missing_operators" && inlinePipeline) {
          const pruned = pruneUnavailableSteps(
            inlinePipeline.steps as EditorPipelineStep[],
            preflightResolution.missingIssues,
          );
          if (pruned.steps.length === 0) {
            toast.error("The pipeline would be empty after removing unavailable nodes.");
            return;
          }

          setPendingMissingIssues(preflightResolution.missingIssues);
          setPendingLaunchMode(mode);
          setPendingPrunedInlinePipeline({
            name: inlinePipeline.name,
            steps: pruned.steps,
          });
          setShowMissingNodesDialog(true);
          return;
        }

        toast.error("Cannot start run", { description: preflightResolution.message });
        return;
      }
    } catch {
      toast.warning("Preflight check unavailable — dependency verification was skipped");
    }

    await executeLaunchMode(mode, resolveInlinePipeline());
  };

  const handleConfirmPrunedLaunch = async () => {
    if (!pendingLaunchMode || !pendingPrunedInlinePipeline) {
      return;
    }
    setShowMissingNodesDialog(false);
    await executeLaunchMode(pendingLaunchMode, pendingPrunedInlinePipeline);
    setPendingLaunchMode(null);
    setPendingMissingIssues([]);
    setPendingPrunedInlinePipeline(null);
  };

  // Can close if not starting (allow closing during running - it's background)
  const { canClose, executionInputsDisabled } = derivePipelineExecutionViewState({
    status,
    isQuickRunning,
  });

  const handleDatasetChange = useCallback((datasetId: string) => {
    setSelectedDataset(datasetId);
    setSplitGroupByByDataset((current) => ensureDatasetGroupByEntry(current, datasetId));
  }, []);

  const handleRuntimeGroupByChange = useCallback((datasetId: string, groupBy: string | null) => {
    setSplitGroupByByDataset((current) => ({
      ...current,
      [datasetId]: groupBy,
    }));
  }, []);

  const handleRunAgain = useCallback(() => {
    reset();
    setIsQuickRunning(false);
  }, [reset]);

  return (
    <Dialog open={open} onOpenChange={canClose ? onOpenChange : undefined}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              {pipelineName}
            </DialogTitle>
            <div className="flex items-center gap-3">
              {jobId && <ConnectionIndicator connected={isConnected} />}
              <StatusBadge status={status} />
            </div>
          </div>
          <DialogDescription>
            Execute this pipeline against a dataset.
            {variantCount && variantCount > 1 && (
              <span className="ml-1 text-purple-500">
                ({variantCount} variants to test)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "execute" | "export")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="execute">Execute</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>

          <TabsContent value="execute" className="space-y-4 mt-4">
            <RunNameField
              value={runName}
              onChange={setRunName}
              disabled={executionInputsDisabled}
            />

            <DatasetSelector
              datasets={datasets}
              disabled={executionInputsDisabled}
              isLoading={isLoadingDatasets}
              selectedDataset={selectedDataset}
              onDatasetChange={handleDatasetChange}
            />

            <RuntimeBackendSelector
              runtimeEngine={runtimeEngine}
              allowFallback={allowFallback}
              disabled={executionInputsDisabled}
              compact
              onRuntimeEngineChange={setRuntimeEngine}
              onAllowFallbackChange={setAllowFallback}
            />

            <RuntimeGroupingConflictNotice groupingSelection={groupingSelection} />

            {selectedDatasetInfo &&
              selectedDatasetGroupingState &&
              groupingSelection.hasSplitters &&
              !groupingSelection.hasPersistedGroupConflict && (
                <RuntimeGroupingSection
                  disabled={executionInputsDisabled}
                  groupingSelection={groupingSelection}
                  groupingState={selectedDatasetGroupingState}
                  selectedDataset={selectedDataset}
                  selectedGroupBy={splitGroupByByDataset[selectedDataset]}
                  onGroupByChange={handleRuntimeGroupByChange}
                />
              )}

            <RuntimeGroupingStatusMessage
              hasSelectedDataset={Boolean(selectedDatasetInfo)}
              isLoadingPipeline={isLoadingPipeline}
              hasSplitters={groupingSelection.hasSplitters}
            />

            <ExecutionPlanPreview preview={selectedExecutionPlanPreview} />

            <ExecutionFeedback
              error={error}
              progress={progress}
              progressMessage={progressMessage}
              result={result}
              status={status}
            />
          </TabsContent>

          <TabsContent value="export" className="mt-4">
            <ExportPanel pipelineId={pipelineId} />
          </TabsContent>
        </Tabs>

        <ExecutionActions
          canRun={canRun}
          isQuickRunning={isQuickRunning}
          status={status}
          onCancel={() => onOpenChange(false)}
          onContinueWorking={() => onOpenChange(false)}
          onDone={() => onOpenChange(false)}
          onLaunch={(mode) => { void handleLaunch(mode); }}
          onRunAgain={handleRunAgain}
          onStopExecution={cancel}
        />
      </DialogContent>
      <MissingNodesConfirmDialog
        open={showMissingNodesDialog}
        onOpenChange={(open) => {
          setShowMissingNodesDialog(open);
          if (!open) {
            setPendingLaunchMode(null);
            setPendingMissingIssues([]);
            setPendingPrunedInlinePipeline(null);
          }
        }}
        issues={pendingMissingIssues}
        onConfirm={() => { void handleConfirmPrunedLaunch(); }}
      />
    </Dialog>
  );
}

export default PipelineExecutionDialog;
