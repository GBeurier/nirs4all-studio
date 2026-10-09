import { useTranslation } from "react-i18next";
import i18n from "i18next";
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
import { getStorageHealth } from "@/api/workspace";
import type { StorageHealthResponse } from "@/types/storage";
import { MigrationDialog } from "./MigrationDialog";
import { MaintenanceActions } from "./MaintenanceActions";
import { getStorageModeLabel } from "./WorkspaceStatsData";
import { getActiveLocale } from "@/lib/activeLocale";

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
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : i18n.t("settings.storageHealth.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const integrity = useMemo(() => {
    if (!health) return { label: t("settings.storageHealth.integrityUnknown"), icon: ShieldAlert, tone: "text-muted-foreground" };
    if (health.corrupt_files.length > 0) {
      return { label: t("settings.storageHealth.integrityCorrupt"), icon: ShieldAlert, tone: "text-destructive" };
    }
    if (health.orphan_metadata_count > 0 || health.orphan_array_count > 0) {
      return { label: t("settings.storageHealth.integrityOrphans"), icon: AlertTriangle, tone: "text-amber-600" };
    }
    return { label: t("settings.storageHealth.integrityHealthy"), icon: CheckCircle2, tone: "text-green-600" };
  }, [health, t]);

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
          {error || t("settings.storageHealth.unavailable")}
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
                {t("settings.storageHealth.title")}
              </CardTitle>
              <CardDescription>
                {t("settings.storageHealth.description")}
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" aria-label={t("common.a11y.refresh")} onClick={loadHealth}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {health.migration_needed && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t("settings.storageHealth.legacyTitle")}</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  {t("settings.storageHealth.legacyBody")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMigrationDialogOpen(true)}
                  >
                    {t("settings.storageHealth.dryRun")}
                  </Button>
                  <Button size="sm" onClick={() => setMigrationDialogOpen(true)}>
                    {t("settings.storageHealth.migrateNow")}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getStatusVariant(health.storage_mode)}>
              {t("settings.storageHealth.mode", { mode: getStorageModeLabel(health.storage_mode, t) })}
            </Badge>
            <Badge variant="outline">
              {t("settings.storageHealth.predictions", { value: health.total_predictions.toLocaleString(getActiveLocale()) })}
            </Badge>
            <Badge variant="outline">{t("settings.storageHealth.datasets", { value: health.total_datasets })}</Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{t("settings.storageHealth.database")}</div>
              <div className="text-sm font-medium">{formatBytes(health.duckdb_size_bytes)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{t("settings.storageHealth.parquetArrays")}</div>
              <div className="text-sm font-medium">{formatBytes(health.parquet_total_size_bytes)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{t("settings.storageHealth.integrity")}</div>
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
              {t("settings.storageHealth.perDataset")}
            </p>
            {health.datasets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("settings.storageHealth.noParquet")}</p>
            ) : (
              <div className="max-h-56 overflow-auto space-y-1">
                {health.datasets.map((dataset) => (
                  <div
                    key={dataset.name}
                    className="flex items-center justify-between rounded border px-2 py-1.5 text-sm"
                  >
                    <span className="truncate">{dataset.name}</span>
                    <span className="text-muted-foreground">
                      {t("settings.storageHealth.datasetSummary", { value: dataset.prediction_count.toLocaleString(getActiveLocale()), size: formatBytes(dataset.parquet_size_bytes) })}
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

