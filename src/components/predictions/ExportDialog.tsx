import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { exportAggregatedPredictions } from "@/api/aggregatedPredictions";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasets: string[];
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ExportDialog({ open, onOpenChange, datasets }: ExportDialogProps) {
  const { t } = useTranslation();
  const [exportSelection, setExportSelection] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (open) setExportSelection(new Set(datasets));
  }, [open, datasets]);

  const toggleExportDataset = (datasetName: string) => {
    const next = new Set(exportSelection);
    if (next.has(datasetName)) next.delete(datasetName);
    else next.add(datasetName);
    setExportSelection(next);
  };

  const handleExportPredictions = async () => {
    const datasetNames = Array.from(exportSelection);
    if (datasetNames.length === 0) {
      toast.error(t("predictions.export.selectAtLeastOne"));
      return;
    }

    setIsExporting(true);
    try {
      const format = datasetNames.length === 1 ? "parquet" : "zip";
      const blob = await exportAggregatedPredictions({ dataset_names: datasetNames, format });
      downloadBlob(
        blob,
        format === "parquet"
          ? `${datasetNames[0]}.parquet`
          : `predictions_export_${new Date().toISOString().slice(0, 10)}.zip`,
      );
      toast.success(t("predictions.export.ready"));
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error, t("predictions.export.failed")));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("predictions.export.title")}</DialogTitle>
          <DialogDescription>{t("predictions.export.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-60 overflow-auto">
          {datasets.map(datasetName => (
            <label key={datasetName} className="flex items-center gap-2 text-sm">
              <Checkbox checked={exportSelection.has(datasetName)} onCheckedChange={() => toggleExportDataset(datasetName)} />
              <span>{datasetName}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setExportSelection(new Set(datasets))} disabled={isExporting}>{t("common.all")}</Button>
          <Button variant="outline" size="sm" onClick={() => setExportSelection(new Set())} disabled={isExporting}>{t("common.none")}</Button>
          <Button onClick={handleExportPredictions} disabled={isExporting}>
            {isExporting ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />{t("predictions.export.exporting")}</> : t("common.download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
