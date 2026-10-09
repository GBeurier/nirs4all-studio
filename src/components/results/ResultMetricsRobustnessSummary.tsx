import { Fragment } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  FileSpreadsheet,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  exportRowsCsv,
  sanitizeFilename,
} from "@/components/predictions/viewer/export";
import {
  createRobustnessDegradationHeatmap,
  createRobustnessDegradationRows,
  createRobustnessWorstSliceRows,
  formatRobustnessSummaryMetric,
  type RobustnessDegradationHeatmapCell,
  type RobustnessDegradationHeatmapTone,
  type RobustnessDegradationRow,
  type RobustnessDegradationTone,
  type RobustnessCoverageStatus,
  type RobustnessSummaryCard,
  type RobustnessWorstSliceRow,
} from "@/ui/robustness";
import type { ConformalGuaranteeTone } from "@/ui/conformal";
import type { ResultRobustnessSummaryData } from "./resultDetailData";

interface ResultMetricsRobustnessSummaryProps {
  summary: ResultRobustnessSummaryData | null;
}

interface RobustnessScenarioCsvRow {
  bias: number;
  coverage_max_abs_gap: number | null;
  coverage_mean_width: number | null;
  coverage_min_observed: number | null;
  coverage_status: string;
  distribution: string | null;
  mae: number;
  mae_delta: number;
  max_abs_error: number;
  n_samples: number;
  execution_scope: string | null;
  requires_spectral_replay: boolean;
  rmse: number;
  rmse_delta: number;
  scenario_index: number;
  scenario_label: string;
  severity: number;
  worst_slice_json: string;
  worst_slice_label: string | null;
  worst_slice_metric: string;
  worst_slice_value: number | null;
}

export const ROBUSTNESS_SCENARIO_CSV_COLUMNS: (keyof RobustnessScenarioCsvRow)[] = [
  "scenario_index",
  "scenario_label",
  "severity",
  "distribution",
  "n_samples",
  "rmse",
  "rmse_delta",
  "mae",
  "mae_delta",
  "bias",
  "max_abs_error",
  "coverage_status",
  "execution_scope",
  "requires_spectral_replay",
  "coverage_min_observed",
  "coverage_max_abs_gap",
  "coverage_mean_width",
  "worst_slice_label",
  "worst_slice_metric",
  "worst_slice_value",
  "worst_slice_json",
];

const statusBadgeVariant: Record<RobustnessCoverageStatus, "default" | "secondary" | "destructive" | "outline"> = {
  ok: "default",
  warning: "secondary",
  critical: "destructive",
  unknown: "outline",
};

const guaranteeBadgeVariant: Record<ConformalGuaranteeTone, "default" | "secondary" | "destructive" | "outline"> = {
  success: "default",
  error: "destructive",
  muted: "outline",
};

const degradationToneBadgeVariant: Record<RobustnessDegradationTone, "default" | "secondary" | "destructive" | "outline"> = {
  improved: "default",
  unchanged: "secondary",
  worse: "destructive",
};

const heatmapToneClass: Record<RobustnessDegradationHeatmapTone, string> = {
  improved: "border-emerald-500/30 text-emerald-950 dark:text-emerald-100",
  unchanged: "border-border/60 bg-muted/30 text-muted-foreground",
  unknown: "border-dashed border-border/60 bg-muted/10 text-muted-foreground",
  worse: "border-destructive/30 text-destructive-foreground dark:text-destructive-foreground",
};

function formatMode(mode: ResultRobustnessSummaryData["mode"]): string {
  return mode.replace(/_/g, " ");
}

function formatFingerprint(fingerprint: string): string {
  return fingerprint.length > 24
    ? `${fingerprint.slice(0, 12)}…${fingerprint.slice(-8)}`
    : fingerprint;
}

function formatSpectralReplaySource(source: NonNullable<ResultRobustnessSummaryData["spectralReplay"]>["source"], t: TFunction): string {
  return source === "predictor_bundle" ? t("results.robustness.replaySource.bundle") : t("results.robustness.replaySource.memory");
}

function formatExecutionScope(scope: RobustnessSummaryCard["executionScope"], t: TFunction): string {
  if (scope === "baseline") return t("results.robustness.scope.baseline");
  if (scope === "prediction_replay") return t("results.robustness.scope.predictionReplay");
  if (scope === "spectral_replay") return t("results.robustness.scope.spectralReplay");
  return t("results.robustness.scope.unknown");
}

export function buildRobustnessScenarioCsvRows(summary: ResultRobustnessSummaryData): RobustnessScenarioCsvRow[] {
  return summary.cards.map(card => ({
    bias: card.bias,
    coverage_max_abs_gap: card.coverage.maxAbsGap,
    coverage_mean_width: card.coverage.meanWidth,
    coverage_min_observed: card.coverage.minObserved,
    coverage_status: card.status,
    distribution: card.distribution,
    mae: card.mae,
    mae_delta: card.maeDelta,
    max_abs_error: card.maxAbsError,
    n_samples: card.nSamples,
    execution_scope: card.executionScope ?? null,
    requires_spectral_replay: Boolean(card.requiresSpectralReplay),
    rmse: card.rmse,
    rmse_delta: card.rmseDelta,
    scenario_index: card.scenarioIndex,
    scenario_label: card.scenarioLabel,
    severity: card.severity,
    worst_slice_json: JSON.stringify(card.worstSlice.key ?? {}),
    worst_slice_label: card.worstSlice.label,
    worst_slice_metric: card.worstSlice.metric,
    worst_slice_value: card.worstSlice.value,
  }));
}

export function buildRobustnessScenarioCsvFilename(summary: ResultRobustnessSummaryData): string {
  return `robustness_${sanitizeFilename(summary.fingerprint)}_scenarios.csv`;
}

function RobustnessDegradationMatrix({ rows }: { rows: RobustnessDegradationRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 rounded-md border border-border/60 bg-muted/10 p-2.5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">{t("results.robustness.matrix.title")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("results.robustness.matrix.description")}
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {t("results.robustness.scenarioCount", { count: rows.length })}
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[620px]">
          <div className="grid grid-cols-5 gap-1 border-b border-border/60 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{t("results.robustness.scenario")}</span>
            <span>RMSE Δ</span>
            <span>MAE Δ</span>
            <span>{t("results.robustness.matrix.coverage")}</span>
            <span>{t("results.robustness.matrix.worstSlice")}</span>
          </div>
          <div className="divide-y divide-border/50">
            {rows.map(row => (
              <div
                key={`${row.scenarioIndex}-${row.scenarioLabel}-degradation`}
                className="grid grid-cols-5 items-center gap-1 py-1.5 text-[11px]"
              >
                <span className="truncate font-medium text-foreground">{row.scenarioLabel}</span>
                <Badge variant={degradationToneBadgeVariant[row.rmseDeltaTone]} className="w-fit text-[10px]">
                  {row.rmseDeltaLabel}
                </Badge>
                <Badge variant={degradationToneBadgeVariant[row.maeDeltaTone]} className="w-fit text-[10px]">
                  {row.maeDeltaLabel}
                </Badge>
                <Badge variant={statusBadgeVariant[row.coverageStatus]} className="w-fit text-[10px]">
                  {t(`results.robustness.coverageStatus.${row.coverageStatus}`)}
                </Badge>
                <span className="truncate text-muted-foreground">
                  {row.worstSliceLabel ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function heatmapCellBackground(cell: RobustnessDegradationHeatmapCell): string | undefined {
  const alpha = 0.12 + (cell.intensity * 0.46);
  if (cell.tone === "improved") return `rgba(16, 185, 129, ${alpha})`;
  if (cell.tone === "worse") return `rgba(239, 68, 68, ${alpha})`;
  return undefined;
}

function RobustnessDegradationHeatmap({ cells }: { cells: RobustnessDegradationHeatmapCell[] }) {
  const { t } = useTranslation();
  if (cells.length === 0) return null;

  const metrics = Array.from(new Map(cells.map(cell => [cell.metric, cell.metricLabel])).entries());
  const scenarios = Array.from(
    new Map(cells.map(cell => [cell.scenarioIndex, cell.scenarioLabel])).entries(),
  );
  const cellByKey = new Map(cells.map(cell => [`${cell.scenarioIndex}:${cell.metric}`, cell]));

  return (
    <div className="mb-3 rounded-md border border-border/60 bg-muted/10 p-2.5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">{t("results.robustness.heatmap.title")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("results.robustness.heatmap.description")}
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {t("results.robustness.scenarioCount", { count: scenarios.length })} · {t("results.robustness.metricCount", { count: metrics.length })}
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid min-w-[520px] gap-1 text-[11px]"
          style={{ gridTemplateColumns: `minmax(140px, 1fr) repeat(${metrics.length}, minmax(86px, 0.7fr))` }}
        >
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("results.robustness.scenario")}</span>
          {metrics.map(([metric, label]) => (
            <span key={metric} className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
          ))}
          {scenarios.map(([scenarioIndex, scenarioLabel]) => (
            <Fragment key={scenarioIndex}>
              <span key={`${scenarioIndex}:label`} className="truncate rounded border border-border/40 bg-background/50 px-2 py-1 font-medium text-foreground">
                {scenarioLabel}
              </span>
              {metrics.map(([metric]) => {
                const cell = cellByKey.get(`${scenarioIndex}:${metric}`);
                if (!cell) return <span key={`${scenarioIndex}:${metric}`} className="rounded border border-border/40 px-2 py-1 text-muted-foreground">—</span>;
                return (
                  <span
                    key={`${scenarioIndex}:${metric}`}
                    className={`rounded border px-2 py-1 font-medium ${heatmapToneClass[cell.tone]}`}
                    style={{ backgroundColor: heatmapCellBackground(cell) }}
                    title={`${cell.scenarioLabel} · ${cell.metricLabel}: ${cell.valueLabel}`}
                  >
                    {cell.valueLabel}
                  </span>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function RobustnessWorstSliceTable({ rows }: { rows: RobustnessWorstSliceRow[] }) {
  const { t } = useTranslation();
  const availableRows = rows.filter(row => row.available);
  if (availableRows.length === 0) return null;

  return (
    <div className="mb-3 rounded-md border border-border/60 bg-muted/10 p-2.5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">{t("results.robustness.slices.title")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("results.robustness.slices.description")}
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {t("results.robustness.slices.count", { count: availableRows.length })}
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-4 gap-1 border-b border-border/60 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{t("results.robustness.scenario")}</span>
            <span>{t("results.robustness.slices.slice")}</span>
            <span>{t("results.robustness.slices.metric")}</span>
            <span>{t("results.robustness.slices.value")}</span>
          </div>
          <div className="divide-y divide-border/50">
            {availableRows.map(row => (
              <div
                key={`${row.scenarioIndex}-${row.scenarioLabel}-${row.sliceLabel}-${row.metric}`}
                className="grid grid-cols-4 items-center gap-1 py-1.5 text-[11px]"
              >
                <span className="truncate font-medium text-foreground">{row.scenarioLabel}</span>
                <span className="truncate text-muted-foreground">{row.sliceLabel}</span>
                <Badge variant="outline" className="w-fit text-[10px]">
                  {row.metric || "—"}
                </Badge>
                <span className="font-medium text-foreground">{row.valueLabel}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RobustnessScenarioCard({ card }: { card: RobustnessSummaryCard }) {
  const { t } = useTranslation();
  const distributionLabel = card.distribution ? card.distribution.replace(/_/g, " ") : null;

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{card.scenarioLabel}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("results.robustness.card.severity", { value: formatRobustnessSummaryMetric(card.severity, 2) })}
            {distributionLabel ? ` · ${distributionLabel}` : ""}
            {" · "}
            {t("results.conformal.sampleCount", { count: card.nSamples })}
          </p>
        </div>
        <Badge variant={statusBadgeVariant[card.status]} className="shrink-0 text-[10px]">
          {t(`results.robustness.coverageStatus.${card.status}`)}
        </Badge>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <Badge
          variant={card.requiresSpectralReplay ? "secondary" : "outline"}
          className="text-[10px]"
        >
          {formatExecutionScope(card.executionScope, t)}
        </Badge>
        {card.requiresSpectralReplay && (
          <Badge variant="outline" className="text-[10px]">
            {t("results.robustness.card.replayEvidence")}
          </Badge>
        )}
        {distributionLabel && (
          <Badge variant="outline" className="text-[10px]">
            {t("results.robustness.card.distribution", { value: distributionLabel })}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Metric label="RMSE" value={formatRobustnessSummaryMetric(card.rmse)} delta={card.rmseDelta} />
        <Metric label="MAE" value={formatRobustnessSummaryMetric(card.mae)} delta={card.maeDelta} />
        <Metric label={t("results.robustness.card.bias")} value={formatRobustnessSummaryMetric(card.bias)} />
        <Metric label={t("results.robustness.card.coverageMin")} value={formatRobustnessSummaryMetric(card.coverage.minObserved)} />
      </div>

      {card.worstSlice.label && (
        <p className="mt-2 break-words text-[11px] text-muted-foreground">
          {t("results.robustness.card.worstSlice", { slice: card.worstSlice.label, metric: card.worstSlice.metric, value: formatRobustnessSummaryMetric(card.worstSlice.value) })}
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, delta }: { label: string; value: string; delta?: number }) {
  return (
    <div className="rounded border border-border/50 bg-background/60 px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <div className="font-medium text-foreground">
        {value}
        {delta != null && delta !== 0 && (
          <span className="ml-1 text-muted-foreground">
            ({delta > 0 ? "+" : ""}{formatRobustnessSummaryMetric(delta)})
          </span>
        )}
      </div>
    </div>
  );
}

export function ResultMetricsRobustnessSummary({ summary }: ResultMetricsRobustnessSummaryProps) {
  const { t } = useTranslation();
  if (!summary || summary.cards.length === 0) return null;

  const degradationRows = createRobustnessDegradationRows(summary.cards);
  const degradationHeatmap = createRobustnessDegradationHeatmap(summary.cards);
  const worstSliceRows = createRobustnessWorstSliceRows(summary.cards);

  const handleExportScenarios = () => {
    exportRowsCsv(
      buildRobustnessScenarioCsvRows(summary),
      ROBUSTNESS_SCENARIO_CSV_COLUMNS,
      buildRobustnessScenarioCsvFilename(summary),
    );
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            {t("results.robustness.title")}
          </h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("results.robustness.report", { mode: formatMode(summary.mode), version: summary.reportVersion })}
            {summary.sliceBy.length > 0 && ` · ${t("results.robustness.sliceBy", { slices: summary.sliceBy.join(", ") })}`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant={guaranteeBadgeVariant[summary.guarantee.tone]} className="text-[10px]">
              {summary.guarantee.label}
            </Badge>
            {summary.guarantee.coverageLabel !== "—" && (
              <Badge variant="outline" className="text-[10px]">
                {summary.guarantee.coverageLabel}
              </Badge>
            )}
            {summary.guarantee.effectiveEngine !== "unknown" && (
              <Badge variant="outline" className="text-[10px]">
                {summary.guarantee.effectiveEngine}
              </Badge>
            )}
          </div>
          {summary.guarantee.invalidationReasons.length > 0 && (
            <p className="mt-1 text-[11px] text-destructive">
              {t("results.conformal.invalidated", { reasons: summary.guarantee.invalidationReasons.join("; ") })}
            </p>
          )}
          {summary.spectralReplay && (
            <div className="mt-2 rounded-md border border-border/60 bg-muted/10 px-2 py-1.5 text-[11px] text-muted-foreground">
              <p className="font-medium text-foreground">{t("results.robustness.replay.title")}</p>
              <p>
                {formatSpectralReplaySource(summary.spectralReplay.source, t)}
                {" · "}
                {t("results.robustness.replay.route", { route: summary.spectralReplay.route })}
                {" · "}
                {summary.spectralReplay.sample_ids_forwarded ? t("results.robustness.replay.idsForwarded") : t("results.robustness.replay.idsNotForwarded")}
              </p>
              {summary.spectralReplay.predictor_bundle && (
                <p className="break-all">
                  {t("results.robustness.replay.bundle", { bundle: summary.spectralReplay.predictor_bundle })}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[10px]"
            onClick={handleExportScenarios}
          >
            <FileSpreadsheet className="h-3 w-3" />
            {t("results.robustness.scenariosCsv")}
          </Button>
          <Badge variant="outline" className="max-w-48 break-all text-[10px]">
            {formatFingerprint(summary.fingerprint)}
          </Badge>
        </div>
      </div>

      <RobustnessDegradationHeatmap cells={degradationHeatmap} />

      <RobustnessDegradationMatrix rows={degradationRows} />

      <RobustnessWorstSliceTable rows={worstSliceRows} />

      <div className="space-y-2">
        {summary.cards.map(card => (
          <RobustnessScenarioCard key={`${card.scenarioIndex}-${card.scenarioLabel}`} card={card} />
        ))}
      </div>
    </div>
  );
}
