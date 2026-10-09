import { useTranslation } from "react-i18next";
import { AlertTriangle, Target } from "lucide-react";

import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-display";

export function InspectorCanvasLoadingState() {
  const { t } = useTranslation();

  return (
    <LoadingState
      message={t("inspector.canvas.loading")}
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
  const { t } = useTranslation();

  return (
    <ErrorState
      title={t("inspector.canvas.errorTitle")}
      message={error}
      onRetry={onRefresh}
      retryLabel={t("inspector.canvas.errorRetry")}
    />
  );
}

export interface InspectorCanvasNoPredictionsStateProps {
  onRefresh: () => void;
}

export function InspectorCanvasNoPredictionsState({
  onRefresh,
}: InspectorCanvasNoPredictionsStateProps) {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon={Target}
      title={t("inspector.canvas.noPredictionsTitle")}
      description={t("inspector.canvas.noPredictionsDescription")}
      action={{ label: t("common.refresh"), onClick: onRefresh }}
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
  const { t } = useTranslation();

  return (
    <EmptyState
      icon={AlertTriangle}
      title={t("inspector.canvas.noMatchTitle")}
      description={hasActiveFilters
        ? t("inspector.canvas.noMatchFiltered")
        : t("inspector.canvas.noMatchSources")
      }
      action={hasActiveFilters
        ? { label: t("inspector.canvas.clearLocalFilters"), onClick: onClearFilters }
        : { label: t("common.refresh"), onClick: onRefresh }
      }
      secondaryAction={hasActiveFilters ? { label: t("common.refresh"), onClick: onRefresh } : undefined}
    />
  );
}
