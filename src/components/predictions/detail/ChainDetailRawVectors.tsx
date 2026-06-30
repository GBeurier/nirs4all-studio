import type { ReactNode } from "react";
import {
  ChevronDown,
  Layers,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { partitionBadgeClass } from "@/lib/partitionColors";
import { formatMetricValue } from "@/lib/scores";
import { cn } from "@/lib/utils";
import type { ResultArtifactRef } from "@/lib/resultArtifacts";
import type { PredictionArraysResponse } from "@/types/aggregated-predictions";
import type { PartitionDataset } from "@/components/predictions/viewer/types";

interface SummaryStats {
  min: number;
  max: number;
  mean: number;
}

interface ResidualStats {
  mean: number;
  sigma: number;
}

interface VectorSummary {
  dataset: PartitionDataset;
  observed: SummaryStats | null;
  predicted: SummaryStats | null;
  residuals: ResidualStats | null;
}

interface ChainDetailRawVectorsProps {
  hasSelectedPrediction: boolean;
  loading: boolean;
  vectorSummaries: VectorSummary[];
  arrayData: PredictionArraysResponse | null;
  arrayArtifactRef: ResultArtifactRef | null;
  metric: string | null;
}

export function ChainDetailRawVectors({
  hasSelectedPrediction,
  loading,
  vectorSummaries,
  arrayData,
  arrayArtifactRef,
  metric,
}: ChainDetailRawVectorsProps) {
  return (
    <RawDetailsSection>
      {!hasSelectedPrediction ? (
        <div className="text-xs text-muted-foreground">
          Select a related prediction above to inspect raw-vector summaries.
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading vector summaries...
        </div>
      ) : vectorSummaries.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No vector data is available for the current selection.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 xl:grid-cols-2">
            {vectorSummaries.map((summary) => (
              <VectorSummaryCard
                key={summary.dataset.predictionId}
                summary={summary}
                metric={metric}
              />
            ))}
          </div>
          {arrayData && <ArrayDataSummary arrayData={arrayData} arrayArtifactRef={arrayArtifactRef} />}
        </div>
      )}
    </RawDetailsSection>
  );
}

function RawDetailsSection({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-border/70 bg-card/40 open:bg-card/70">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-2",
          "rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Raw vectors</span>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/60 px-3 py-3 text-sm">{children}</div>
    </details>
  );
}

function VectorSummaryCard({
  summary,
  metric,
}: {
  summary: VectorSummary;
  metric: string | null;
}) {
  const { dataset, observed, predicted, residuals } = summary;
  return (
    <div className="rounded-xl border border-border/60 bg-background/65 p-4">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={cn("h-5 px-1.5 text-[10px]", partitionBadgeClass(dataset.partition))}
        >
          {dataset.label}
        </Badge>
        <span className="text-[11px] text-muted-foreground">{dataset.nSamples} samples</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <VectorStatCard label="y_true" stats={observed} metric={metric} />
        <VectorStatCard label="y_pred" stats={predicted} metric={metric} />
        <ResidualStatCard residuals={residuals} metric={metric} />
      </div>
    </div>
  );
}

function VectorStatCard({
  label,
  stats,
  metric,
}: {
  label: string;
  stats: SummaryStats | null;
  metric: string | null;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/70 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {stats ? `${formatMetricValue(stats.min, metric ?? undefined)} to ${formatMetricValue(stats.max, metric ?? undefined)}` : "-"}
      </div>
      <div className="font-mono text-sm font-semibold">
        {stats ? formatMetricValue(stats.mean, metric ?? undefined) : "-"}
      </div>
    </div>
  );
}

function ResidualStatCard({
  residuals,
  metric,
}: {
  residuals: ResidualStats | null;
  metric: string | null;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/70 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        residuals
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">mean</div>
      <div className="font-mono text-sm font-semibold">
        {residuals ? formatMetricValue(residuals.mean, metric ?? undefined) : "-"}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        sigma {residuals ? formatMetricValue(residuals.sigma, metric ?? undefined) : "-"}
      </div>
    </div>
  );
}

function ArrayDataSummary({
  arrayData,
  arrayArtifactRef,
}: {
  arrayData: PredictionArraysResponse;
  arrayArtifactRef: ResultArtifactRef | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <ArrayFact label="Prediction ID" value={arrayData.prediction_id} title={arrayData.prediction_id} />
      <ArrayFact label="Samples" value={arrayData.n_samples} emphasis />
      <ArrayFact label="y_proba" value={arrayData.y_proba ? arrayData.y_proba.length : "-"} emphasis />
      {arrayArtifactRef && (
        <ArrayFact
          label="Artifact ref"
          value={arrayArtifactRef.source}
          title={arrayArtifactRef.id}
        />
      )}
      <div className="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
        <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          Extra vectors
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          sample_indices {arrayData.sample_indices ? arrayData.sample_indices.length : "-"}
          <br />
          weights {arrayData.weights ? arrayData.weights.length : "-"}
        </div>
      </div>
    </div>
  );
}

function ArrayFact({
  label,
  value,
  title,
  emphasis = false,
}: {
  label: string;
  value: string | number;
  title?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono",
          emphasis ? "text-sm font-semibold" : "text-xs",
        )}
        title={title}
      >
        {value}
      </div>
    </div>
  );
}
