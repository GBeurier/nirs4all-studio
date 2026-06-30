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
import { Loader2, Trash2 } from "lucide-react";

interface DatasetResultDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetName: string;
  busy: boolean;
  onDelete: () => void;
}

export function DatasetResultDeleteDialog({
  open,
  onOpenChange,
  datasetName,
  busy,
  onDelete,
}: DatasetResultDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete dataset predictions?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes all stored predictions for {datasetName} in the active workspace. Empty chains, pipelines, arrays, and orphaned artifacts will be cleaned automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Delete predictions
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
