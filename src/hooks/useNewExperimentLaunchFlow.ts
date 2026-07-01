import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { runPreflight } from "@/api/runs";
import {
  buildExperimentPreflightRequest,
  getRunPreflightArgs,
  LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
  type ExperimentExecutionAdapter,
  type SubmitExperimentLaunchSubmissionOptions,
} from "@/lib/experimentExecutionAdapter";
import {
  buildExperimentLaunchPayloadPlan,
  buildExperimentLaunchSelectionPayloadPlan,
  type ExperimentLaunchPayloadPlan,
} from "@/lib/experimentLaunchPayload";
import type { SelectedPipelineConfig } from "@/lib/experimentPipelineSelection";
import type { CampaignSinglePairSplitSpecResult } from "@/lib/campaignPlanPreviewTypes";
import {
  createClosedExperimentMissingNodesDialogState,
  createOpenExperimentMissingNodesDialogState,
  EXPERIMENT_LAUNCH_GROUPING_BLOCKED_MESSAGE,
  EXPERIMENT_LAUNCH_PREFLIGHT_BLOCKED_TITLE,
  EXPERIMENT_LAUNCH_PREFLIGHT_UNAVAILABLE_MESSAGE,
  setExperimentMissingNodesDialogOpen,
} from "@/lib/experimentLaunchFlowState";
import { resolveExperimentLaunchPreflightDecision } from "@/lib/experimentLaunchPreflight";
import type { MissingOperatorIssue } from "@/lib/pipelineOperatorAvailability";
import { useNewExperimentLaunchSubmissionMutation } from "./useNewExperimentLaunchSubmissionMutation";

export interface UseNewExperimentLaunchFlowInput {
  experimentName: string;
  experimentDescription?: string;
  selectedDatasetIds: string[];
  selectedPipelineConfigs: SelectedPipelineConfig[];
  selectedGroupingPayload: Record<string, string | null>;
  singlePairSplitSpecResult?: CampaignSinglePairSplitSpecResult;
  hasGroupingBlockingError: boolean;
  executionAdapter?: ExperimentExecutionAdapter;
  runtimeEngine?: string | null;
  allowFallback?: boolean;
  launchSubmitters?: SubmitExperimentLaunchSubmissionOptions;
  onGroupingBlockingError: () => void;
  onRunCreated: (runId: string) => void;
}

export interface UseNewExperimentLaunchFlowResult {
  isLaunching: boolean;
  isPreflighting: boolean;
  pendingMissingIssues: MissingOperatorIssue[];
  showMissingNodesDialog: boolean;
  launchPayloadPlan: ExperimentLaunchPayloadPlan;
  handleLaunch: () => Promise<void>;
  handleConfirmPrunedLaunch: () => void;
  handleMissingNodesDialogOpenChange: (open: boolean) => void;
}

export function useNewExperimentLaunchFlow({
  experimentName,
  experimentDescription,
  selectedDatasetIds,
  selectedPipelineConfigs,
  selectedGroupingPayload,
  singlePairSplitSpecResult = { splitSpecs: [], skippedRunIds: [] },
  hasGroupingBlockingError,
  executionAdapter = LEGACY_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
  runtimeEngine,
  allowFallback,
  launchSubmitters,
  onGroupingBlockingError,
  onRunCreated,
}: UseNewExperimentLaunchFlowInput): UseNewExperimentLaunchFlowResult {
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [missingNodesDialogState, setMissingNodesDialogState] = useState(createClosedExperimentMissingNodesDialogState);
  const {
    isLaunching,
    submitLaunchPayloadPlan,
  } = useNewExperimentLaunchSubmissionMutation({
    executionAdapter,
    launchSubmitters,
    onRunCreated,
  });

  const buildLaunchPayloadPlan = useCallback((missingIssues: MissingOperatorIssue[] = []): ExperimentLaunchPayloadPlan => {
    return buildExperimentLaunchSelectionPayloadPlan({
      name: experimentName,
      description: experimentDescription,
      selectedDatasetIds,
      selectedPipelineConfigs,
      selectedGroupingPayload,
      strictCampaignSpecs: singlePairSplitSpecResult,
      executionAdapter,
      missingIssues,
      runtimeEngine,
      allowFallback,
    });
  }, [
    allowFallback,
    executionAdapter,
    experimentDescription,
    experimentName,
    runtimeEngine,
    selectedDatasetIds,
    selectedGroupingPayload,
    selectedPipelineConfigs,
    singlePairSplitSpecResult,
  ]);
  const launchPayloadPlan = useMemo(() => buildLaunchPayloadPlan(), [buildLaunchPayloadPlan]);

  const handleLaunch = useCallback(async () => {
    if (hasGroupingBlockingError) {
      toast.error(EXPERIMENT_LAUNCH_GROUPING_BLOCKED_MESSAGE);
      onGroupingBlockingError();
      return;
    }

    let currentLaunchPayloadPlan = buildLaunchPayloadPlan();
    let launchConfig = currentLaunchPayloadPlan.legacyConfig;
    try {
      setIsPreflighting(true);
      const preflightRequest = buildExperimentPreflightRequest(executionAdapter, launchConfig);
      const preflight = await runPreflight(...getRunPreflightArgs(preflightRequest));
      const preflightDecision = resolveExperimentLaunchPreflightDecision({
        preflight,
        launchConfig,
        buildPrunedLaunchConfig: (missingIssues) => buildLaunchPayloadPlan(missingIssues).legacyConfig,
      });

      if (preflightDecision.status === "blocked") {
        toast.error(EXPERIMENT_LAUNCH_PREFLIGHT_BLOCKED_TITLE, { description: preflightDecision.message });
        return;
      }

      if (preflightDecision.status === "confirm_pruned") {
        setMissingNodesDialogState(createOpenExperimentMissingNodesDialogState(
          preflightDecision.launchConfig,
          preflightDecision.missingIssues,
        ));
        return;
      }

      launchConfig = preflightDecision.launchConfig;
      currentLaunchPayloadPlan = buildExperimentLaunchPayloadPlan({
        executionAdapter,
        legacyConfig: launchConfig,
        strictCampaignSpecs: singlePairSplitSpecResult,
      });
    } catch {
      toast.warning(EXPERIMENT_LAUNCH_PREFLIGHT_UNAVAILABLE_MESSAGE);
    } finally {
      setIsPreflighting(false);
    }

    submitLaunchPayloadPlan(currentLaunchPayloadPlan);
  }, [
    buildLaunchPayloadPlan,
    executionAdapter,
    hasGroupingBlockingError,
    onGroupingBlockingError,
    singlePairSplitSpecResult,
    submitLaunchPayloadPlan,
  ]);

  const handleConfirmPrunedLaunch = useCallback(() => {
    if (!missingNodesDialogState.launchConfig) return;
    const prunedLaunchPayloadPlan = buildLaunchPayloadPlan(missingNodesDialogState.missingIssues);
    submitLaunchPayloadPlan(prunedLaunchPayloadPlan, {
      legacyConfig: missingNodesDialogState.launchConfig,
    });
    setMissingNodesDialogState(createClosedExperimentMissingNodesDialogState());
  }, [
    buildLaunchPayloadPlan,
    missingNodesDialogState.launchConfig,
    missingNodesDialogState.missingIssues,
    submitLaunchPayloadPlan,
  ]);

  const handleMissingNodesDialogOpenChange = useCallback((open: boolean) => {
    setMissingNodesDialogState((current) => setExperimentMissingNodesDialogOpen(current, open));
  }, []);

  return {
    isLaunching,
    isPreflighting,
    pendingMissingIssues: missingNodesDialogState.missingIssues,
    showMissingNodesDialog: missingNodesDialogState.isOpen,
    launchPayloadPlan,
    handleLaunch,
    handleConfirmPrunedLaunch,
    handleMissingNodesDialogOpenChange,
  };
}
