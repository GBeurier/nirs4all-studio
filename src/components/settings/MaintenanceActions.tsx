import { useMemo, useState } from "react";
import { Loader2, Wrench, Trash2, Filter } from "lucide-react";
import { toast } from "sonner";
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
} from "@/api/client";
import type { CleanDeadLinksReport, RemoveBottomReport } from "@/types/storage";

interface MaintenanceActionsProps {
  onChanged?: () => void;
}

export function MaintenanceActions({ onChanged }: MaintenanceActionsProps) {
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
      toast.success(`Compaction completed. Rows removed: ${rowsRemoved.toLocaleString()}`);
      onChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Compaction failed";
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
      toast.info("Cleanup dry run completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup preview failed";
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
        `Cleanup done. Metadata: ${result.metadata_orphans_removed}, arrays: ${result.array_orphans_removed}`
      );
      onChanged?.();
      setCleanOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup failed";
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
      toast.info("Remove-bottom dry run completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Remove-bottom preview failed";
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
      toast.success(`Removed ${result.removed} predictions`);
      onChanged?.();
      setRemoveOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Remove-bottom failed";
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
        Compact
      </Button>

      <Dialog open={cleanOpen} onOpenChange={setCleanOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={running !== null}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clean Dead Links
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clean Dead Links</DialogTitle>
            <DialogDescription>
              Run a dry-run preview first, then confirm cleanup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button variant="outline" onClick={previewCleanup} disabled={running !== null}>
              {running === "clean-preview" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Previewing...
                </>
              ) : (
                "Preview Cleanup"
              )}
            </Button>
            {cleanPreview && (
              <div className="text-sm text-muted-foreground">
                Metadata orphans: {cleanPreview.metadata_orphans_removed} | Array orphans:{" "}
                {cleanPreview.array_orphans_removed}
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
                  Cleaning...
                </>
              ) : (
                "Confirm Cleanup"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={running !== null}>
            <Filter className="mr-2 h-4 w-4" />
            Remove Bottom %
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Bottom Predictions</DialogTitle>
            <DialogDescription>
              Preview the removal first, then confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Fraction to remove (0-1)</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={fraction}
                onChange={(e) => setFraction(Number(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">{fractionPercent}% will be removed</p>
            </div>
            <div className="space-y-1">
              <Label>Metric</Label>
              <Input value={metric} onChange={(e) => setMetric(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Partition</Label>
              <Input value={partition} onChange={(e) => setPartition(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Dataset (optional)</Label>
              <Input
                placeholder="all datasets"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
              />
            </div>

            <Separator />
            <Button variant="outline" onClick={previewRemoveBottom} disabled={running !== null}>
              {running === "remove-preview" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Previewing...
                </>
              ) : (
                "Preview Removal"
              )}
            </Button>
            {removePreview && (
              <div className="text-sm text-muted-foreground">
                Removed: {removePreview.removed} | Remaining: {removePreview.remaining} | Threshold:{" "}
                {removePreview.threshold_score}
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
                  Removing...
                </>
              ) : (
                "Confirm Removal"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MaintenanceActions;

