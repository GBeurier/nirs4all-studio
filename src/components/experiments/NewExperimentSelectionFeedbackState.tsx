import { InlineError, InlineLoading } from "@/components/ui/state-display";
import { getExperimentSelectionErrorMessage } from "@/lib/experimentSelectionPresentation";

export interface NewExperimentSelectionFeedbackStateProps {
  error: unknown;
  errorFallback: string;
  isLoading: boolean;
  loadingMessage: string;
}

export function NewExperimentSelectionFeedbackState({
  error,
  errorFallback,
  isLoading,
  loadingMessage,
}: NewExperimentSelectionFeedbackStateProps) {
  return (
    <>
      {isLoading && <InlineLoading message={loadingMessage} />}
      {error && (
        <InlineError message={getExperimentSelectionErrorMessage(error, errorFallback)} />
      )}
    </>
  );
}
