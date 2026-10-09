import { useMemo, useState } from "react";
import { Loader2, Wrench, Trash2, Filter } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { describeApiError } from "@/lib/userFacingError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  cleanDeadLinks,
  compactStorage,
  removeBottomPredictions,
} from "@/api/workspace";
import type { CleanDeadLinksReport, RemoveBottomReport } from "@/types/storage";
import { getActiveLocale } from "@/lib/activeLocale";

interface MaintenanceActionsProps {
  onChanged?: () => void;
}

export function MaintenanceActions({ onChanged }: MaintenanceActionsProps) {
  const { t } = useTranslation();
  const [running, setRunning] = useState<string | null>(null);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [cleanPreview, setCleanPreview] = useState<CleanDeadLinksReport | null>(null);
  const [removePreview, setRemovePreview] = useState<RemoveBottomReport | null>(null);
  const [fraction, setFraction] = useState(0.2);
  const [metric, setMetric] = useState("val_score");
  const [partition, setPartition] = useState("val");
  const [datasetName, setDatasetName] = useState("");

  const fractionPercent = useMemo(() => Math.round(fraction * 100), [fraction]);

  const handleCompact = async () => {
    setRunning("compact");
    try {
      const result = await compactStorage();
      const rowsRemoved = Object.values(result.datasets || {}).reduce(
        (sum, ds) => sum + (ds.rows_removed || 0),
        0
      );
      toast.success(t("settings.maintenance.compactDone", { rows: rowsRemoved.toLocaleString(getActiveLocale()) }));
      onChanged?.();
    } catch (error) {
      const message = describeApiError(error, t, t("settings.maintenance.compactFailed")).message;
      toast.error(message);
    } finally {
      setRunning(null);
    }
  };

  const previewCleanup = async () => {
    setRunning("clean-preview");
    try {
      const preview = await cleanDeadLinks(true);
      setCleanPreview(preview);
      toast.info(t("settings.maintenance.cleanDryRunDone"));
    } catch (error) {
      const message = describeApiError(error, t, t("settings.maintenance.cleanPreviewFailed")).message;
      toast.error(message);
    } finally {
      setRunning(null);
    }
  };

  const applyCleanup = async () => {
    setRunning("clean-apply");
    try {
      const result = await cleanDeadLinks(false);
      setCleanPreview(result);
      toast.success(
        t("settings.maintenance.cleanDone", {
          metadata: result.metadata_orphans_removed,
          arrays: result.array_orphans_removed,
        })
      );
      onChanged?.();
      setCleanOpen(false);
    } catch (error) {
      const message = describeApiError(error, t, t("settings.maintenance.cleanFailed")).message;
      toast.error(message);
    } finally {
      setRunning(null);
    }
  };

  const previewRemoveBottom = async () => {
    setRunning("remove-preview");
    try {
      const preview = await removeBottomPredictions({
        fraction,
        metric,
        partition,
        dataset_name: datasetName || undefined,
        dry_run: true,
      });
      setRemovePreview(preview);
      toast.info(t("settings.maintenance.removeDryRunDone"));
    } catch (error) {
      const message = describeApiError(error, t, t("settings.maintenance.removePreviewFailed")).message;
      toast.error(message);
    } finally {
      setRunning(null);
    }
  };

  const applyRemoveBottom = async () => {
    setRunning("remove-apply");
    try {
      const result = await removeBottomPredictions({
        fraction,
        metric,
        partition,
        dataset_name: datasetName || undefined,
        dry_run: false,
      });
      setRemovePreview(result);
      toast.success(t("settings.maintenance.removeDone", { count: result.removed }));
      onChanged?.();
      setRemoveOpen(false);
    } catch (error) {
      const message = describeApiError(error, t, t("settings.maintenance.removeFailed")).message;
      toast.error(message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleCompact} disabled={running !== null}>
        {running === "compact" ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Wrench className="mr-2 h-4 w-4" />
        )}
        {t("settings.maintenance.compact")}
      </Button>

      <Dialog open={cleanOpen} onOpenChange={setCleanOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={running !== null}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t("settings.maintenance.cleanDeadLinks")}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.maintenance.cleanDeadLinks")}</DialogTitle>
            <DialogDescription>
              {t("settings.maintenance.cleanDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button variant="outline" onClick={previewCleanup} disabled={running !== null}>
              {running === "clean-preview" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("settings.maintenance.previewing")}
                </>
              ) : (
                t("settings.maintenance.previewCleanup")
              )}
            </Button>
            {cleanPreview && (
              <div className="text-sm text-muted-foreground">
                {t("settings.maintenance.cleanPreviewSummary", {
                  metadata: cleanPreview.metadata_orphans_removed,
                  arrays: cleanPreview.array_orphans_removed,
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={applyCleanup}
              disabled={running !== null || cleanPreview === null}
            >
              {running === "clean-apply" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("settings.maintenance.cleaning")}
                </>
              ) : (
                t("settings.maintenance.confirmCleanup")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={running !== null}>
            <Filter className="mr-2 h-4 w-4" />
            {t("settings.maintenance.removeBottomButton")}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.maintenance.removeTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.maintenance.removeDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("settings.maintenance.fraction")}</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={fraction}
                onChange={(e) => setFraction(Number(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">{t("settings.maintenance.fractionHint", { percent: fractionPercent })}</p>
            </div>
            <div className="space-y-1">
              <Label>{t("settings.maintenance.metric")}</Label>
              <Input value={metric} onChange={(e) => setMetric(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("settings.maintenance.partition")}</Label>
              <Input value={partition} onChange={(e) => setPartition(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("settings.maintenance.datasetOptional")}</Label>
              <Input
                placeholder={t("settings.maintenance.allDatasets")}
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
              />
            </div>

            <Separator />
            <Button variant="outline" onClick={previewRemoveBottom} disabled={running !== null}>
              {running === "remove-preview" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("settings.maintenance.previewing")}
                </>
              ) : (
                t("settings.maintenance.previewRemoval")
              )}
            </Button>
            {removePreview && (
              <div className="text-sm text-muted-foreground">
                {t("settings.maintenance.removePreviewSummary", {
                  removed: removePreview.removed,
                  remaining: removePreview.remaining,
                  threshold: removePreview.threshold_score,
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={applyRemoveBottom}
              disabled={running !== null || removePreview === null}
            >
              {running === "remove-apply" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("settings.maintenance.removing")}
                </>
              ) : (
                t("settings.maintenance.confirmRemoval")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MaintenanceActions;

