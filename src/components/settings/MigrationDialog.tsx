import { useEffect, useMemo, useState } from "react";
import i18n from "i18next";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { describeApiError } from "@/lib/userFacingError";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { formatBytes } from "@/utils/formatters";
import {
  getMigrationStatus,
  startMigration,
} from "@/api/workspace";
import { useJobUpdates } from "@/hooks/useWebSocket";
import type { MigrationReport, MigrationStatusResponse } from "@/types/storage";
import { getActiveLocale } from "@/lib/activeLocale";

interface MigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}

function isMigrationReport(value: unknown): value is MigrationReport {
  return Boolean(
    value &&
      typeof value === "object" &&
      "total_rows" in (value as Record<string, unknown>) &&
      "rows_migrated" in (value as Record<string, unknown>)
  );
}

export function MigrationDialog({ open, onOpenChange, onCompleted }: MigrationDialogProps) {
  const { t } = useTranslation();
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [batchSize, setBatchSize] = useState<number>(10000);
  const [report, setReport] = useState<MigrationReport | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    status: jobStatus,
    progress,
    progressMessage,
    result,
    error: jobError,
  } = useJobUpdates(jobId);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const load = async () => {
      setStatusLoading(true);
      try {
        const data = await getMigrationStatus();
        if (mounted) setMigrationStatus(data);
      } catch (error) {
        if (mounted) {
          const message = describeApiError(error, t, t("settings.migration.statusLoadFailed")).message;
          setActionError(message);
        }
      } finally {
        if (mounted) setStatusLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [open, t]);

  useEffect(() => {
    if (jobStatus !== "completed") return;
    const maybeReport = (result?.report ?? result) as unknown;
    if (isMigrationReport(maybeReport)) {
      setReport(maybeReport);
    }
    toast.success(i18n.t("settings.migration.completed"));
    onCompleted?.();
  }, [jobStatus, result, onCompleted]);

  useEffect(() => {
    if (jobStatus !== "failed") return;
    const message = jobError || i18n.t("settings.migration.failed");
    setActionError(message);
    toast.error(message);
  }, [jobStatus, jobError]);

  const isRunning = useMemo(
    () => jobStatus === "pending" || jobStatus === "running",
    [jobStatus]
  );

  const runDryRun = async () => {
    setActionError(null);
    setReport(null);
    try {
      const response = await startMigration({
        dry_run: true,
        batch_size: batchSize,
      });
      if (isMigrationReport(response)) {
        setReport(response);
        toast.success(t("settings.migration.dryRunCompleted"));
      } else {
        throw new Error(t("settings.migration.unexpectedDryRun"));
      }
    } catch (error) {
      const message = describeApiError(error, t, t("settings.migration.dryRunFailed")).message;
      setActionError(message);
      toast.error(message);
    }
  };

  const startFullMigration = async () => {
    setActionError(null);
    setReport(null);
    try {
      const response = await startMigration({
        dry_run: false,
        batch_size: batchSize,
      });
      if ("job_id" in response) {
        setJobId(response.job_id);
        toast.info(t("settings.migration.startedBackground"));
      } else {
        throw new Error(t("settings.migration.unexpectedResponse"));
      }
    } catch (error) {
      const message = describeApiError(error, t, t("settings.migration.startFailed")).message;
      setActionError(message);
      toast.error(message);
    }
  };

  const resetDialog = () => {
    setActionError(null);
    setReport(null);
    setJobId(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t("settings.migration.title")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.migration.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline">
              {t("settings.migration.mode", { mode: migrationStatus?.storage_mode ?? t("settings.migration.unknown") })}
            </Badge>
            <Badge variant={migrationStatus?.migration_needed ? "secondary" : "outline"}>
              {migrationStatus?.migration_needed ? t("settings.migration.required") : t("settings.migration.upToDate")}
            </Badge>
            {migrationStatus?.legacy_row_count != null && (
              <span className="text-muted-foreground">
                {t("settings.migration.legacyRows", { count: migrationStatus.legacy_row_count.toLocaleString(getActiveLocale()) })}
              </span>
            )}
            {migrationStatus?.estimated_duration_seconds != null && (
              <span className="text-muted-foreground">
                {t("settings.migration.eta", { seconds: migrationStatus.estimated_duration_seconds })}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t("settings.migration.batchSize")}</label>
            <Input
              type="number"
              min={1000}
              step={1000}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value) || 10000)}
              disabled={isRunning}
            />
          </div>

          {isRunning && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-muted-foreground">
                {progressMessage || t("settings.migration.inProgress", { percent: Math.round(progress) })}
              </p>
            </div>
          )}

          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}

          {statusLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("settings.migration.loadingStatus")}
            </div>
          )}

          {report && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  {t("settings.migration.report.title")}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>{t("settings.migration.report.totalRows", { count: report.total_rows.toLocaleString(getActiveLocale()) })}</div>
                  <div>{t("settings.migration.report.rowsMigrated", { count: report.rows_migrated.toLocaleString(getActiveLocale()) })}</div>
                  <div>{t("settings.migration.report.verification", { result: report.verification_passed ? t("settings.migration.report.passed") : t("settings.migration.report.failed") })}</div>
                  <div>{t("settings.migration.report.mismatches", { count: report.verification_mismatches })}</div>
                  <div>{t("settings.migration.report.dbBefore", { size: formatBytes(report.duckdb_size_before) })}</div>
                  <div>{t("settings.migration.report.dbAfter", { size: formatBytes(report.duckdb_size_after) })}</div>
                  <div>{t("settings.migration.report.parquetSize", { size: formatBytes(report.parquet_total_size) })}</div>
                  <div>{t("settings.migration.report.duration", { seconds: report.duration_seconds.toFixed(2) })}</div>
                </div>
                {report.errors.length > 0 && (
                  <div className="text-sm text-destructive">
                    {report.errors.join(" | ")}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={runDryRun} disabled={isRunning}>
            {t("settings.migration.runDryRun")}
          </Button>
          <Button onClick={startFullMigration} disabled={isRunning}>
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("settings.migration.running")}
              </>
            ) : (
              t("settings.migration.start")
            )}
          </Button>
          <Button variant="ghost" onClick={resetDialog} disabled={isRunning}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MigrationDialog;

