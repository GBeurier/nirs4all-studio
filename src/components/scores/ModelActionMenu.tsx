import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical, Eye, ScatterChart, BarChart3, Zap,
  Download, FileSpreadsheet, ExternalLink,
  Database, Pencil, Loader2, Trash2,
} from "lucide-react";
import {
  deleteWorkspaceChainPredictions,
  deleteWorkspacePredictionGroup,
  getChainPartitionDetail,
} from "@/api/client";
import {
  formatPredictionDeletionSummary,
  invalidatePredictionRelatedQueries,
} from "@/lib/prediction-deletion";

interface ModelActionMenuProps {
  chainId: string;
  modelName: string;
  datasetName?: string;
  runId?: string;
  hasRefit: boolean;
  workspaceId?: string;
  deleteScope?: "chain" | "group";
  foldId?: string;
  onViewDetails?: () => void;
  onExport?: () => void;
  onDeleted?: () => void;
}

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(value: string | null | undefined): string {
  return (value || "chain").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function ModelActionMenu({
  chainId, modelName, datasetName, runId,
  hasRefit, workspaceId, deleteScope, foldId, onViewDetails, onExport, onDeleted,
}: ModelActionMenuProps) {
  const queryClient = useQueryClient();
  const [csvBusy, setCsvBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const predictionsUrl = `/predictions?${new URLSearchParams({
    ...(runId ? { run_id: runId } : {}),
    ...(datasetName ? { dataset: datasetName } : {}),
    model: modelName,
  }).toString()}`;
  const pipelineEditorUrl = chainId ? `/pipelines/new?chainId=${encodeURIComponent(chainId)}` : null;
  const canDelete = Boolean(
    workspaceId
    && chainId
    && (deleteScope === "chain" || (deleteScope === "group" && foldId))
  );
  const deleteTitle = deleteScope === "group" ? "Delete prediction group?" : "Delete model predictions?";
  const deleteDescription = deleteScope === "group"
    ? `This removes the ${foldId || "selected"} prediction group for ${modelName}, including linked arrays. Empty chains and orphaned artifacts will be cleaned automatically.`
    : `This removes all predictions for ${modelName}. Empty chains, pipelines, arrays, and orphaned artifacts will be cleaned automatically.`;
  const deleteLabel = deleteScope === "group" ? "Delete prediction" : "Delete model";

  const handleCsvExport = async () => {
    if (!chainId) {
      toast.error("Missing chain id");
      return;
    }
    setCsvBusy(true);
    try {
      const detail = await getChainPartitionDetail(chainId);
      const rows = detail.predictions || [];
      if (rows.length === 0) {
        toast.error("No predictions found for this chain");
        return;
      }
      const header = [
        "fold_id", "partition", "model_name", "dataset_name",
        "val_score", "test_score", "train_score", "metric",
        "n_samples", "preprocessings",
      ];
      const lines = rows.map((row) => header.map((col) => csvEscape((row as Record<string, unknown>)[col])).join(","));
      const csv = [header.join(","), ...lines].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, `${sanitizeFilename(modelName)}_${sanitizeFilename(chainId.slice(0, 8))}.csv`);
      toast.success("CSV exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "CSV export failed");
    } finally {
      setCsvBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!workspaceId || !chainId) {
      toast.error("Missing workspace or chain identifier");
      return;
    }

    setDeleteBusy(true);
    try {
      const result = deleteScope === "group"
        ? await deleteWorkspacePredictionGroup(workspaceId, chainId, foldId || "")
        : await deleteWorkspaceChainPredictions(workspaceId, chainId);

      if (!result.success) {
        toast.error("Nothing was deleted");
        return;
      }

      await invalidatePredictionRelatedQueries(queryClient);
      onDeleted?.();
      setDeleteOpen(false);
      toast.success(formatPredictionDeletionSummary(result));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deletion failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {onViewDetails && (
            <DropdownMenuItem onClick={onViewDetails}>
              <Eye className="h-4 w-4 mr-2" /> View details
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to={predictionsUrl}>
              <ScatterChart className="h-4 w-4 mr-2" /> Scatter plot
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={predictionsUrl}>
              <BarChart3 className="h-4 w-4 mr-2" /> Residual analysis
            </Link>
          </DropdownMenuItem>

          {hasRefit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={`/predict?model_id=${encodeURIComponent(chainId)}&source=chain`}>
                  <Zap className="h-4 w-4 mr-2" /> Predict (new data)
                </Link>
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />

          {onExport && (
            <DropdownMenuItem onClick={onExport}>
              <Download className="h-4 w-4 mr-2" /> Export (.parquet)
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); handleCsvExport(); }} disabled={csvBusy}>
            {csvBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
            Export (.csv)
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {pipelineEditorUrl && (
            <DropdownMenuItem asChild>
              <Link to={pipelineEditorUrl}>
                <ExternalLink className="h-4 w-4 mr-2" /> Goto pipeline
              </Link>
            </DropdownMenuItem>
          )}
          {pipelineEditorUrl && (
            <DropdownMenuItem asChild>
              <Link to={pipelineEditorUrl}>
                <Pencil className="h-4 w-4 mr-2" /> Edit pipeline
              </Link>
            </DropdownMenuItem>
          )}
          {datasetName && (
            <DropdownMenuItem asChild>
              <Link to={`/datasets/${encodeURIComponent(datasetName)}`}>
                <Database className="h-4 w-4 mr-2" /> Goto dataset
              </Link>
            </DropdownMenuItem>
          )}

          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={(event) => {
                  event.preventDefault();
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" /> {deleteLabel}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteBusy}>
              {deleteBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              {deleteLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
