import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  FileSpreadsheet,
  SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  exportRowsCsv,
  sanitizeFilename,
} from "@/components/predictions/viewer/export";
import type { TuningTrialTone } from "@/ui/tuning";
import type { ResultTuningSummaryData } from "./resultDetailData";

interface ResultMetricsTuningSummaryProps {
  summary: ResultTuningSummaryData | null;
}

interface TuningTrialCsvRow {
  diagnostics_json: string;
  is_best: boolean;
  params_json: string;
  status: string;
  trial_number: number;
  value: number | null;
}

export const TUNING_TRIAL_CSV_COLUMNS: (keyof TuningTrialCsvRow)[] = [
  "trial_number",
  "status",
  "value",
  "is_best",
  "params_json",
  "diagnostics_json",
];

const trialToneVariant: Record<TuningTrialTone, "default" | "secondary" | "destructive" | "outline"> = {
  error: "destructive",
  info: "secondary",
  muted: "outline",
  success: "default",
  warning: "secondary",
};

function formatFingerprint(fingerprint: string | null, t: TFunction): string {
  if (!fingerprint) return t("results.conformal.noFingerprint");
  return fingerprint.length > 24
    ? `${fingerprint.slice(0, 12)}…${fingerprint.slice(-8)}`
    : fingerprint;
}

function formatDirection(direction: ResultTuningSummaryData["study"]["direction"], t: TFunction): string {
  return direction === "minimize" ? t("results.tuning.direction.minimize") : t("results.tuning.direction.maximize");
}

function formatOptionalOptimizerMetadata(value: string | number | null): string {
  return value === null ? "—" : String(value);
}

function formatBooleanState(value: boolean | null, trueLabel: string, falseLabel: string): string {
  if (value === null) return "—";
  return value ? trueLabel : falseLabel;
}

export function buildTuningTrialCsvRows(summary: ResultTuningSummaryData): TuningTrialCsvRow[] {
  return summary.trials.map(trial => ({
    diagnostics_json: JSON.stringify(trial.diagnostics),
    is_best: trial.isBest,
    params_json: JSON.stringify(trial.params),
    status: trial.status,
    trial_number: trial.number,
    value: trial.value,
  }));
}

export function buildTuningTrialCsvFilename(summary: ResultTuningSummaryData): string {
  const source = summary.study.studyName
    ?? summary.study.fingerprint
    ?? `${summary.study.optimizer}_${summary.study.metric}`;
  return `native_tuning_${sanitizeFilename(source)}_trials.csv`;
}

function bestTrialLabel(summary: ResultTuningSummaryData, t: TFunction): string {
  const best = summary.trials.find(trial => trial.isBest);
  return best ? t("results.tuning.trialNumber", { number: best.number }) : "—";
}

function trialSegmentClass(tone: TuningTrialTone): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500";
    case "error":
      return "bg-destructive";
    case "warning":
      return "bg-amber-500";
    case "info":
      return "bg-sky-500";
    case "muted":
      return "bg-muted-foreground/40";
  }
}

export function ResultMetricsTuningSummary({ summary }: ResultMetricsTuningSummaryProps) {
  const { t } = useTranslation();
  if (!summary) return null;

  const { persistence, study, trials } = summary;
  const visibleTrials = trials.slice(0, 5);
  const handleExportTrials = () => {
    exportRowsCsv(
      buildTuningTrialCsvRows(summary),
      TUNING_TRIAL_CSV_COLUMNS,
      buildTuningTrialCsvFilename(summary),
    );
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            {t("results.tuning.title")}
          </h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("results.tuning.summaryLine", { optimizer: study.optimizer, direction: formatDirection(study.direction, t), metric: study.metric, count: study.nTrials })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[10px]"
            disabled={trials.length === 0}
            onClick={handleExportTrials}
          >
            <FileSpreadsheet className="h-3 w-3" />
            {t("results.tuning.trialsCsv")}
          </Button>
          <Badge variant="outline" className="max-w-48 break-all text-[10px]">
            {formatFingerprint(study.fingerprint, t)}
          </Badge>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
        <Metric label={t("results.tuning.bestValue")} value={study.bestValueLabel} />
        <Metric label={t("results.tuning.status.complete")} value={String(study.completeTrials)} />
        <Metric label={t("results.tuning.status.failed")} value={String(study.failedTrials)} />
        <Metric label={t("results.tuning.searchDims")} value={String(study.searchSpaceSize)} />
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label={t("results.tuning.sampler")} value={formatOptionalOptimizerMetadata(study.sampler)} />
        <Metric label={t("results.tuning.pruner")} value={formatOptionalOptimizerMetadata(study.pruner)} />
        <Metric label={t("results.tuning.seed")} value={formatOptionalOptimizerMetadata(study.seed)} />
      </div>

      {persistence && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
          <Metric
            label={t("results.tuning.persistence.resume")}
            value={formatBooleanState(persistence.resume, t("results.tuning.persistence.requested"), t("results.tuning.persistence.disabled"))}
          />
          <Metric
            label={t("results.tuning.persistence.storage")}
            value={formatBooleanState(persistence.storageConfigured, t("results.tuning.persistence.configured"), t("results.tuning.persistence.notConfigured"))}
          />
          <Metric
            label={t("results.tuning.persistence.optimizerResume")}
            value={formatBooleanState(persistence.optimizerStateResumeSupported, t("results.tuning.persistence.supported"), t("results.tuning.persistence.notSupported"))}
          />
          <Metric label={t("results.tuning.study")} value={persistence.studyName ?? "—"} />
        </div>
      )}

      {trials.length > 0 && (
        <div className="mb-3 rounded border border-border/50 bg-background/60 px-2 py-2 text-[11px]">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("results.tuning.timeline")}</span>
            <span className="font-medium text-foreground">{t("results.tuning.bestTrial", { trial: bestTrialLabel(summary, t) })}</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-label={t("results.tuning.timelineAria")}>
            {trials.map(trial => (
              <span
                key={trial.number}
                className={`${trialSegmentClass(trial.tone)} min-w-1 flex-1`}
                title={t("results.tuning.trialStatusTitle", { number: trial.number, status: t(`results.tuning.status.${trial.status}`) })}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-muted-foreground">
            <span>{t("results.tuning.count.complete", { count: study.completeTrials })}</span>
            {study.failedTrials > 0 && <span>{t("results.tuning.count.failed", { count: study.failedTrials })}</span>}
            {study.prunedTrials > 0 && <span>{t("results.tuning.count.pruned", { count: study.prunedTrials })}</span>}
            {study.runningTrials > 0 && <span>{t("results.tuning.count.running", { count: study.runningTrials })}</span>}
          </div>
        </div>
      )}

      <div className="mb-3 rounded border border-border/50 bg-background/60 px-2 py-1 text-[11px]">
        <span className="text-muted-foreground">{t("results.tuning.bestParams")}</span>
        <div className="break-words font-medium text-foreground">
          {Object.entries(study.bestParams).length > 0
            ? Object.entries(study.bestParams).map(([key, value]) => `${key}=${String(value)}`).join(", ")
            : "—"}
        </div>
      </div>

      {visibleTrials.length > 0 && (
        <div className="space-y-1.5">
          {visibleTrials.map(trial => (
            <div
              key={trial.number}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 bg-muted/20 px-2 py-1.5 text-[11px]"
            >
              <div className="min-w-0">
                <span className="font-medium">{t("results.tuning.trialNumber", { number: trial.number })}</span>
                {trial.isBest && <span className="ml-1 text-muted-foreground">{t("results.tuning.best")}</span>}
                <p className="truncate text-muted-foreground">{trial.paramsLabel}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="font-medium">{trial.valueLabel}</span>
                <Badge variant={trialToneVariant[trial.tone]} className="text-[10px]">
                  {t(`results.tuning.status.${trial.status}`)}
                </Badge>
              </div>
            </div>
          ))}
          {trials.length > visibleTrials.length && (
            <p className="text-[11px] text-muted-foreground">
              {t("results.tuning.showing", { shown: visibleTrials.length, count: trials.length })}
            </p>
          )}
        </div>
      )}

      {!persistence && study.studyName && (
        <p className="mt-3 text-[11px] text-muted-foreground">{t("results.tuning.studyName", { name: study.studyName })}</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/50 bg-background/60 px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  );
}
