import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createRun } from "@/api/runs";
import {
  buildExperimentLaunchSubmission,
  submitExperimentLaunchSubmission,
  type ExperimentExecutionAdapter,
  type ExperimentLaunchSubmission,
  type SubmitExperimentLaunchSubmissionOptions,
} from "@/lib/experimentExecutionAdapter";
import {
  getExperimentLaunchPayloadSubmissionBlockMessage,
  type ExperimentLaunchPayloadPlan,
} from "@/lib/experimentLaunchPayload";
import {
  EXPERIMENT_LAUNCH_PREFLIGHT_BLOCKED_TITLE,
  EXPERIMENT_LAUNCH_SUCCESS_MESSAGE,
  formatExperimentLaunchFailureMessage,
  getExperimentLaunchFailureDetail,
} from "@/lib/experimentLaunchFlowState";

export interface UseNewExperimentLaunchSubmissionMutationInput {
  executionAdapter: ExperimentExecutionAdapter;
  launchSubmitters?: SubmitExperimentLaunchSubmissionOptions;
  onRunCreated: (runId: string) => void;
}

export interface SubmitNewExperimentLaunchPayloadPlanOptions {
  legacyConfig?: ExperimentLaunchPayloadPlan["legacyConfig"];
}

export interface UseNewExperimentLaunchSubmissionMutationResult {
  isLaunching: boolean;
  submitLaunchPayloadPlan: (
    launchPayloadPlan: ExperimentLaunchPayloadPlan,
    options?: SubmitNewExperimentLaunchPayloadPlanOptions,
  ) => boolean;
}

export function useNewExperimentLaunchSubmissionMutation({
  executionAdapter,
  launchSubmitters,
  onRunCreated,
}: UseNewExperimentLaunchSubmissionMutationInput): UseNewExperimentLaunchSubmissionMutationResult {
  const queryClient = useQueryClient();
  const { mutate: submitExperimentLaunch, isPending: isLaunching } = useMutation({
    mutationFn: (submission: ExperimentLaunchSubmission) =>
      submitExperimentLaunchSubmission(submission, createRun, launchSubmitters),
    onSuccess: (run) => {
      toast.success(EXPERIMENT_LAUNCH_SUCCESS_MESSAGE);
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      onRunCreated(run.id);
    },
    onError: (error) => {
      const detail = getExperimentLaunchFailureDetail(error);
      toast.error(formatExperimentLaunchFailureMessage(detail));
    },
  });

  const submitLaunchPayloadPlan = useCallback((
    launchPayloadPlan: ExperimentLaunchPayloadPlan,
    options: SubmitNewExperimentLaunchPayloadPlanOptions = {},
  ) => {
    const submissionBlockMessage = getExperimentLaunchPayloadSubmissionBlockMessage(launchPayloadPlan);
    if (submissionBlockMessage) {
      toast.error(EXPERIMENT_LAUNCH_PREFLIGHT_BLOCKED_TITLE, { description: submissionBlockMessage });
      return false;
    }

    submitExperimentLaunch(buildExperimentLaunchSubmission(
      executionAdapter,
      options.legacyConfig ?? launchPayloadPlan.legacyConfig,
      launchPayloadPlan.nativePayload,
    ));
    return true;
  }, [executionAdapter, submitExperimentLaunch]);

  return {
    isLaunching,
    submitLaunchPayloadPlan,
  };
}
