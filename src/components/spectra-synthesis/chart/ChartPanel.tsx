/**
 * ChartPanel - Left panel container for chart visualization
 *
 * Layout:
 * - ChartToolbar (top)
 * - SpectraChart (main area, flexible)
 * - TargetHistogram + MetadataView (bottom row, fixed height)
 * - StatsBar (bottom)
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Sparkles, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSynthesisPreview } from "../contexts";
import { useSynthesisBuilder } from "../contexts";
import { ChartToolbar } from "./ChartToolbar";
import { SpectraChart } from "./SpectraChart";
import { TargetHistogram } from "./TargetHistogram";
import { MetadataView } from "./MetadataView";
import { StatsBar } from "./StatsBar";
import { cn } from "@/lib/utils";

interface ChartPanelProps {
  className?: string;
}

export function ChartPanel({ className }: ChartPanelProps) {
  const { state: builderState } = useSynthesisBuilder();
  const {
    state: previewState,
    generatePreview,
    canGenerate,
  } = useSynthesisPreview();

  const [showMean, setShowMean] = useState(true);
  const [showStdBand, setShowStdBand] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Auto-refresh debounce ref
  const autoRefreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle auto-refresh when config changes
  useEffect(() => {
    if (!autoRefresh || !canGenerate || builderState.errors.length > 0) {
      return;
    }

    // Clear existing timeout
    if (autoRefreshTimeoutRef.current) {
      clearTimeout(autoRefreshTimeoutRef.current);
    }

    // Debounce auto-refresh by 500ms
    autoRefreshTimeoutRef.current = setTimeout(() => {
      generatePreview();
    }, 500);

    return () => {
      if (autoRefreshTimeoutRef.current) {
        clearTimeout(autoRefreshTimeoutRef.current);
      }
    };
  }, [autoRefresh, builderState.steps, builderState.n_samples, builderState.random_state, canGenerate, generatePreview, builderState.errors.length]);

  const handleGenerate = useCallback(() => {
    generatePreview();
  }, [generatePreview]);

  const { data, isLoading, error } = previewState;
  const hasErrors = builderState.errors.length > 0;

  return (
    <div className={cn("h-full flex flex-col bg-muted/10", className)}>
      {/* Toolbar */}
      <ChartToolbar
        showMean={showMean}
        onShowMeanChange={setShowMean}
        showStdBand={showStdBand}
        onShowStdBandChange={setShowStdBand}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        onGenerate={handleGenerate}
        isGenerating={isLoading}
        canGenerate={canGenerate}
        hasErrors={hasErrors}
      />

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={handleGenerate} canRetry={canGenerate} />
        ) : data ? (
          <>
            {/* Main spectra chart */}
            <div className="flex-1 min-h-0 p-3">
              <SpectraChart
                data={data}
                showMean={showMean}
                showStdBand={showStdBand}
                className="h-full"
              />
            </div>

            {/* Bottom row: Histogram + Metadata */}
            <div className="shrink-0 h-36 border-t flex">
              <div className="flex-1 border-r">
                <TargetHistogram data={data} className="h-full" />
              </div>
              <div className="w-64">
                <MetadataView data={data} className="h-full" />
              </div>
            </div>

            {/* Stats bar */}
            <div className="shrink-0 px-3 pb-2">
              <StatsBar data={data} />
            </div>
          </>
        ) : (
          <EmptyState onGenerate={handleGenerate} canGenerate={canGenerate} hasErrors={hasErrors} />
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="h-10 w-10 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">Generating preview...</p>
        <p className="text-xs text-muted-foreground mt-1">
          This may take a few seconds
        </p>
      </div>
    </div>
  );
}

interface ErrorStateProps {
  error: string;
  onRetry: () => void;
  canRetry: boolean;
}

function ErrorState({ error, onRetry, canRetry }: ErrorStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md px-4">
        <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-3" />
        <p className="text-sm font-medium text-destructive mb-1">
          Preview Generation Failed
        </p>
        <p className="text-xs text-muted-foreground mb-4">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={!canRetry}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    </div>
  );
}

interface EmptyStateProps {
  onGenerate: () => void;
  canGenerate: boolean;
  hasErrors: boolean;
}

function EmptyState({ onGenerate, canGenerate, hasErrors }: EmptyStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md px-4">
        <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-muted/50 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <h3 className="text-sm font-medium mb-1">No Preview Yet</h3>
        <p className="text-xs text-muted-foreground mb-4">
          {hasErrors
            ? "Fix validation errors in your configuration, then generate a preview."
            : canGenerate
              ? "Click 'Generate' to see your synthetic spectra."
              : "Add at least a Features step to generate synthetic data."}
        </p>
        <Button
          size="sm"
          onClick={onGenerate}
          disabled={!canGenerate || hasErrors}
          className="bg-teal-600 hover:bg-teal-700"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Generate Preview
        </Button>
      </div>
    </div>
  );
}
