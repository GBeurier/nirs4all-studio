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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("results.scores.datasetDeleteDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("results.scores.datasetDeleteDialog.description", { name: datasetName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
            {t("results.scores.datasetDeleteDialog.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
