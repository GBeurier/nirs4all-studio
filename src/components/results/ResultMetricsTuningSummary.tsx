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

function formatFingerprint(fingerprint: string | null): string {
  if (!fingerprint) return "No fingerprint";
  return fingerprint.length > 24
    ? `${fingerprint.slice(0, 12)}…${fingerprint.slice(-8)}`
    : fingerprint;
}

function formatDirection(direction: ResultTuningSummaryData["study"]["direction"]): string {
  return direction === "minimize" ? "minimize" : "maximize";
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

function bestTrialLabel(summary: ResultTuningSummaryData): string {
  const best = summary.trials.find(trial => trial.isBest);
  return best ? `Trial #${best.number}` : "—";
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
            Native tuning
          </h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {study.optimizer} · {formatDirection(study.direction)} {study.metric} · {study.nTrials} trials
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
            Trials CSV
          </Button>
          <Badge variant="outline" className="max-w-48 break-all text-[10px]">
            {formatFingerprint(study.fingerprint)}
          </Badge>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
        <Metric label="Best value" value={study.bestValueLabel} />
        <Metric label="Complete" value={String(study.completeTrials)} />
        <Metric label="Failed" value={String(study.failedTrials)} />
        <Metric label="Search dims" value={String(study.searchSpaceSize)} />
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="Sampler" value={formatOptionalOptimizerMetadata(study.sampler)} />
        <Metric label="Pruner" value={formatOptionalOptimizerMetadata(study.pruner)} />
        <Metric label="Seed" value={formatOptionalOptimizerMetadata(study.seed)} />
      </div>

      {persistence && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
          <Metric
            label="Resume"
            value={formatBooleanState(persistence.resume, "requested", "disabled")}
          />
          <Metric
            label="Storage"
            value={formatBooleanState(persistence.storageConfigured, "configured", "not configured")}
          />
          <Metric
            label="Optimizer resume"
            value={formatBooleanState(persistence.optimizerStateResumeSupported, "supported", "not supported")}
          />
          <Metric label="Study" value={persistence.studyName ?? "—"} />
        </div>
      )}

      {trials.length > 0 && (
        <div className="mb-3 rounded border border-border/50 bg-background/60 px-2 py-2 text-[11px]">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Trial status timeline</span>
            <span className="font-medium text-foreground">Best {bestTrialLabel(summary)}</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-label="Native tuning trial status timeline">
            {trials.map(trial => (
              <span
                key={trial.number}
                className={`${trialSegmentClass(trial.tone)} min-w-1 flex-1`}
                title={`Trial #${trial.number}: ${trial.statusLabel}`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-muted-foreground">
            <span>{study.completeTrials} complete</span>
            {study.failedTrials > 0 && <span>{study.failedTrials} failed</span>}
            {study.prunedTrials > 0 && <span>{study.prunedTrials} pruned</span>}
            {study.runningTrials > 0 && <span>{study.runningTrials} running</span>}
          </div>
        </div>
      )}

      <div className="mb-3 rounded border border-border/50 bg-background/60 px-2 py-1 text-[11px]">
        <span className="text-muted-foreground">Best params</span>
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
                <span className="font-medium">Trial #{trial.number}</span>
                {trial.isBest && <span className="ml-1 text-muted-foreground">best</span>}
                <p className="truncate text-muted-foreground">{trial.paramsLabel}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="font-medium">{trial.valueLabel}</span>
                <Badge variant={trialToneVariant[trial.tone]} className="text-[10px]">
                  {trial.statusLabel}
                </Badge>
              </div>
            </div>
          ))}
          {trials.length > visibleTrials.length && (
            <p className="text-[11px] text-muted-foreground">
              Showing {visibleTrials.length} of {trials.length} trials.
            </p>
          )}
        </div>
      )}

      {!persistence && study.studyName && (
        <p className="mt-3 text-[11px] text-muted-foreground">Study: {study.studyName}</p>
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
