import { AlertTriangle, Target } from "lucide-react";

import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-display";

export function InspectorCanvasLoadingState() {
  return (
    <LoadingState
      message="Loading predictions inspector..."
      className="min-h-[420px]"
    />
  );
}

export interface InspectorCanvasErrorStateProps {
  error: string;
  onRefresh: () => void;
}

export function InspectorCanvasErrorState({
  error,
  onRefresh,
}: InspectorCanvasErrorStateProps) {
  return (
    <ErrorState
      title="Inspector unavailable"
      message={error}
      onRetry={onRefresh}
      retryLabel="Reload inspector"
    />
  );
}

export interface InspectorCanvasNoPredictionsStateProps {
  onRefresh: () => void;
}

export function InspectorCanvasNoPredictionsState({
  onRefresh,
}: InspectorCanvasNoPredictionsStateProps) {
  return (
    <EmptyState
      icon={Target}
      title="No predictions to inspect"
      description="Run or import predictions first, then reopen the inspector."
      action={{ label: "Refresh", onClick: onRefresh }}
    />
  );
}

export interface InspectorCanvasFilteredEmptyStateProps {
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onRefresh: () => void;
}

export function InspectorCanvasFilteredEmptyState({
  hasActiveFilters,
  onClearFilters,
  onRefresh,
}: InspectorCanvasFilteredEmptyStateProps) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="No chains match the current scope"
      description={hasActiveFilters
        ? "Clear local inspector filters to bring chains back into view."
        : "Adjust source filters to broaden the comparison scope."
      }
      action={hasActiveFilters
        ? { label: "Clear local filters", onClick: onClearFilters }
        : { label: "Refresh", onClick: onRefresh }
      }
      secondaryAction={hasActiveFilters ? { label: "Refresh", onClick: onRefresh } : undefined}
    />
  );
}
