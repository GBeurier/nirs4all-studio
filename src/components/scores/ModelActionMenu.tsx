import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  Database, Pencil, Loader2,
} from "lucide-react";
import { getChainPartitionDetail } from "@/api/client";

interface ModelActionMenuProps {
  chainId: string;
  modelName: string;
  datasetName?: string;
  runId?: string;
  hasRefit: boolean;
  onViewDetails?: () => void;
  onExport?: () => void;
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
  hasRefit, onViewDetails, onExport,
}: ModelActionMenuProps) {
  const [csvBusy, setCsvBusy] = useState(false);

  const predictionsUrl = `/predictions?${new URLSearchParams({
    ...(runId ? { run_id: runId } : {}),
    ...(datasetName ? { dataset: datasetName } : {}),
    model: modelName,
  }).toString()}`;
  const pipelineEditorUrl = chainId ? `/pipelines/new?chainId=${encodeURIComponent(chainId)}` : null;

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

  return (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
