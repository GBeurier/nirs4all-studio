import { Link } from "react-router-dom";
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
  MoreVertical, Eye, Zap,
  Download, FileSpreadsheet,
  Database, Pencil, Loader2, Trash2,
} from "lucide-react";
import {
  buildModelActionDeleteDescriptor,
  buildModelActionLinks,
} from "@/lib/modelActionMenuData";
import { useModelActionCsvExport } from "./useModelActionCsvExport";
import { useModelPredictionDeleteAction } from "./useModelPredictionDeleteAction";

interface ModelActionMenuProps {
  chainId: string;
  predictChainId?: string;
  modelName: string;
  datasetName?: string;
  runId?: string;
  taskType?: string | null;
  hasRefit: boolean;
  workspaceId?: string;
  deleteScope?: "chain" | "group";
  foldId?: string;
  onViewDetails?: () => void;
  onViewChart?: () => void;
  onExport?: () => void;
  onDeleted?: () => void;
}

export function ModelActionMenu({
  chainId, predictChainId, modelName, datasetName, runId: _runId,
  taskType: _taskType, hasRefit, workspaceId, deleteScope, foldId, onViewDetails, onViewChart, onExport, onDeleted,
}: ModelActionMenuProps) {
  const actionLinks = buildModelActionLinks({
    chainId,
    predictChainId,
    datasetName,
    hasRefit,
  });
  const deleteDescriptor = buildModelActionDeleteDescriptor({
    chainId,
    deleteScope,
    foldId,
    modelName,
    workspaceId,
  });
  const {
    deleteOpen,
    setDeleteOpen,
    deleteBusy,
    handleDelete,
  } = useModelPredictionDeleteAction({
    chainId,
    deleteScope,
    foldId,
    workspaceId,
    onDeleted,
  });
  const { csvBusy, handleCsvExport } = useModelActionCsvExport({ chainId, modelName });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {onViewChart && (
            <DropdownMenuItem onClick={onViewChart}>
              <Eye className="h-4 w-4 mr-2" /> Chart view
            </DropdownMenuItem>
          )}
          {onViewDetails && (
            <DropdownMenuItem onClick={onViewDetails}>
              <Eye className="h-4 w-4 mr-2" /> View details
            </DropdownMenuItem>
          )}

          {actionLinks.predictUrl && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={actionLinks.predictUrl}>
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

          {actionLinks.pipelineEditorUrl && (
            <DropdownMenuItem asChild>
              <Link to={actionLinks.pipelineEditorUrl}>
                <Pencil className="h-4 w-4 mr-2" /> Open chain snapshot
              </Link>
            </DropdownMenuItem>
          )}
          {actionLinks.datasetUrl && (
            <DropdownMenuItem asChild>
              <Link to={actionLinks.datasetUrl}>
                <Database className="h-4 w-4 mr-2" /> Goto dataset
              </Link>
            </DropdownMenuItem>
          )}

          {deleteDescriptor.canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={(event) => {
                  event.preventDefault();
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" /> {deleteDescriptor.label}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteDescriptor.title}</AlertDialogTitle>
            <AlertDialogDescription>{deleteDescriptor.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteBusy}>
              {deleteBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              {deleteDescriptor.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
