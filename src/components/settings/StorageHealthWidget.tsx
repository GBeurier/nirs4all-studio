import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatBytes } from "@/utils/formatters";
import { getStorageHealth } from "@/api/client";
import type { StorageHealthResponse } from "@/types/storage";
import { MigrationDialog } from "./MigrationDialog";
import { MaintenanceActions } from "./MaintenanceActions";

interface StorageHealthWidgetProps {
  className?: string;
}

function getStatusVariant(mode: string): "default" | "secondary" | "destructive" | "outline" {
  if (mode === "migrated") return "default";
  if (mode === "legacy" || mode === "mid_migration") return "secondary";
  if (mode === "unknown") return "destructive";
  return "outline";
}

export function StorageHealthWidget({ className }: StorageHealthWidgetProps) {
  const [health, setHealth] = useState<StorageHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrationDialogOpen, setMigrationDialogOpen] = useState(false);

  const loadHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getStorageHealth();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load storage health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const integrity = useMemo(() => {
    if (!health) return { label: "Unknown", icon: ShieldAlert, tone: "text-muted-foreground" };
    if (health.corrupt_files.length > 0) {
      return { label: "Corrupt files detected", icon: ShieldAlert, tone: "text-destructive" };
    }
    if (health.orphan_metadata_count > 0 || health.orphan_array_count > 0) {
      return { label: "Orphans detected", icon: AlertTriangle, tone: "text-amber-600" };
    }
    return { label: "Healthy", icon: CheckCircle2, tone: "text-green-600" };
  }, [health]);

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error || !health) {
    return (
      <Card className={className}>
        <CardContent className="p-6 text-sm text-destructive">
          {error || "Storage health is unavailable"}
        </CardContent>
      </Card>
    );
  }

  const IntegrityIcon = integrity.icon;

  return (
    <>
      <Card className={className}>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                Storage Health
              </CardTitle>
              <CardDescription>
                Hybrid storage diagnostics and maintenance controls.
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={loadHealth}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {health.migration_needed && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Legacy array storage detected</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  Migration to Parquet is recommended for better read/write performance.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMigrationDialogOpen(true)}
                  >
                    Run Dry Run
                  </Button>
                  <Button size="sm" onClick={() => setMigrationDialogOpen(true)}>
                    Migrate Now
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getStatusVariant(health.storage_mode)}>
              Mode: {health.storage_mode}
            </Badge>
            <Badge variant="outline">
              Predictions: {health.total_predictions.toLocaleString()}
            </Badge>
            <Badge variant="outline">Datasets: {health.total_datasets}</Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">DuckDB</div>
              <div className="text-sm font-medium">{formatBytes(health.duckdb_size_bytes)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Parquet Arrays</div>
              <div className="text-sm font-medium">{formatBytes(health.parquet_total_size_bytes)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Integrity</div>
              <div className={`text-sm font-medium flex items-center gap-1 ${integrity.tone}`}>
                <IntegrityIcon className="h-4 w-4" />
                {integrity.label}
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4" />
              Per-dataset array footprint
            </p>
            {health.datasets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No dataset parquet files found.</p>
            ) : (
              <div className="max-h-56 overflow-auto space-y-1">
                {health.datasets.map((dataset) => (
                  <div
                    key={dataset.name}
                    className="flex items-center justify-between rounded border px-2 py-1.5 text-sm"
                  >
                    <span className="truncate">{dataset.name}</span>
                    <span className="text-muted-foreground">
                      {dataset.prediction_count.toLocaleString()} preds • {formatBytes(dataset.parquet_size_bytes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />
          <MaintenanceActions onChanged={loadHealth} />
        </CardContent>
      </Card>

      <MigrationDialog
        open={migrationDialogOpen}
        onOpenChange={setMigrationDialogOpen}
        onCompleted={loadHealth}
      />
    </>
  );
}

export default StorageHealthWidget;

