import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical, Eye, ScatterChart, BarChart3, Zap, Lightbulb,
  RefreshCw, Play, Download, FileSpreadsheet, Package, ExternalLink,
  Database, Star, Trash2,
} from "lucide-react";

interface ModelActionMenuProps {
  chainId: string;
  modelName: string;
  datasetName?: string;
  runId?: string;
  pipelineId?: string;
  hasRefit: boolean;
  onViewDetails?: () => void;
  onExport?: () => void;
  onRetrain?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
}

export function ModelActionMenu({
  chainId, modelName, datasetName, runId, pipelineId,
  hasRefit, onViewDetails, onExport, onRetrain, onDelete, onPin,
}: ModelActionMenuProps) {
  const predictionsUrl = `/predictions?${new URLSearchParams({
    ...(runId ? { run_id: runId } : {}),
    ...(datasetName ? { dataset: datasetName } : {}),
    model: modelName,
  }).toString()}`;

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

        <DropdownMenuSeparator />

        {hasRefit && (
          <>
            <DropdownMenuItem asChild>
              <Link to={`/predict?model_id=${encodeURIComponent(chainId)}&source=chain`}>
                <Zap className="h-4 w-4 mr-2" /> Predict (new data)
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Lightbulb className="h-4 w-4 mr-2" /> Explain (SHAP)
            </DropdownMenuItem>
          </>
        )}
        {onRetrain && (
          <DropdownMenuItem onClick={onRetrain}>
            <RefreshCw className="h-4 w-4 mr-2" /> Retrain
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled>
          <Play className="h-4 w-4 mr-2" /> Replay pipeline
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {onExport && (
          <DropdownMenuItem onClick={onExport}>
            <Download className="h-4 w-4 mr-2" /> Export (.parquet)
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled>
          <FileSpreadsheet className="h-4 w-4 mr-2" /> Export (.csv)
        </DropdownMenuItem>
        {hasRefit && (
          <DropdownMenuItem disabled>
            <Package className="h-4 w-4 mr-2" /> Export bundle (.n4a)
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {pipelineId && (
          <DropdownMenuItem asChild>
            <Link to={`/editor?pipeline_id=${encodeURIComponent(pipelineId)}`}>
              <ExternalLink className="h-4 w-4 mr-2" /> Goto pipeline
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
        {onPin && (
          <DropdownMenuItem onClick={onPin}>
            <Star className="h-4 w-4 mr-2" /> Pin as favorite
          </DropdownMenuItem>
        )}

        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
