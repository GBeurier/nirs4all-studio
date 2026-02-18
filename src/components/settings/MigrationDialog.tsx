import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
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
} from "@/api/client";
import { useJobUpdates } from "@/hooks/useWebSocket";
import type { MigrationReport, MigrationStatusResponse } from "@/types/storage";

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
          const message = error instanceof Error ? error.message : "Failed to load migration status";
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
  }, [open]);

  useEffect(() => {
    if (jobStatus !== "completed") return;
    const maybeReport = (result?.report ?? result) as unknown;
    if (isMigrationReport(maybeReport)) {
      setReport(maybeReport);
    }
    toast.success("Migration completed");
    onCompleted?.();
  }, [jobStatus, result, onCompleted]);

  useEffect(() => {
    if (jobStatus !== "failed") return;
    const message = jobError || "Migration failed";
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
        toast.success("Dry run completed");
      } else {
        throw new Error("Unexpected dry-run response");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dry run failed";
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
        toast.info("Migration started in background");
      } else {
        throw new Error("Unexpected migration response");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start migration";
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
            Array Storage Migration
          </DialogTitle>
          <DialogDescription>
            Migrate legacy DuckDB prediction arrays into Parquet sidecar files.
            Back up `store.duckdb` before running a full migration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline">
              Mode: {migrationStatus?.storage_mode ?? "unknown"}
            </Badge>
            <Badge variant={migrationStatus?.migration_needed ? "secondary" : "outline"}>
              {migrationStatus?.migration_needed ? "Migration required" : "Up to date"}
            </Badge>
            {migrationStatus?.legacy_row_count != null && (
              <span className="text-muted-foreground">
                Legacy rows: {migrationStatus.legacy_row_count.toLocaleString()}
              </span>
            )}
            {migrationStatus?.estimated_duration_seconds != null && (
              <span className="text-muted-foreground">
                ETA: {migrationStatus.estimated_duration_seconds}s
              </span>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Batch size</label>
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
                {progressMessage || `Migration in progress (${Math.round(progress)}%)`}
              </p>
            </div>
          )}

          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}

          {statusLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading migration status...
            </div>
          )}

          {report && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Migration Report
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Total rows: {report.total_rows.toLocaleString()}</div>
                  <div>Rows migrated: {report.rows_migrated.toLocaleString()}</div>
                  <div>Verification: {report.verification_passed ? "Passed" : "Failed"}</div>
                  <div>Mismatches: {report.verification_mismatches}</div>
                  <div>DuckDB before: {formatBytes(report.duckdb_size_before)}</div>
                  <div>DuckDB after: {formatBytes(report.duckdb_size_after)}</div>
                  <div>Parquet size: {formatBytes(report.parquet_total_size)}</div>
                  <div>Duration: {report.duration_seconds.toFixed(2)}s</div>
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
            Run Dry Run
          </Button>
          <Button onClick={startFullMigration} disabled={isRunning}>
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              "Start Migration"
            )}
          </Button>
          <Button variant="ghost" onClick={resetDialog} disabled={isRunning}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MigrationDialog;

