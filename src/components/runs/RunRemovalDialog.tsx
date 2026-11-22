import { useTranslation } from "react-i18next";
import { EyeOff, Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export type RunRemovalChoice = "entry" | "everything";

interface RunRemovalDialogProps {
  open: boolean;
  runName: string;
  busy: boolean;
  canDelete: boolean;
  /** Remaining runs after this one; shows the "apply to all" checkbox when > 0. */
  remainingCount?: number;
  applyToAll?: boolean;
  onApplyToAllChange?: (value: boolean) => void;
  onChoose: (choice: RunRemovalChoice) => void;
  onCancel: () => void;
}

/** Asks whether to remove only the history entry or the run with all its data. */
export function RunRemovalDialog({
  open,
  runName,
  busy,
  canDelete,
  remainingCount = 0,
  applyToAll = false,
  onApplyToAllChange,
  onChoose,
  onCancel,
}: RunRemovalDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("runs.removal.title", { name: runName })}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">{t("runs.removal.entryDescription")}</span>
            <span className="block">{t("runs.removal.everythingDescription")}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remainingCount > 0 && onApplyToAllChange && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={applyToAll} onCheckedChange={(value) => onApplyToAllChange(value === true)} disabled={busy} />
            {t("runs.removal.applyToAll", { count: remainingCount })}
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onCancel}>{t("common.cancel")}</AlertDialogCancel>
          <Button variant="outline" disabled={busy} onClick={() => onChoose("entry")}>
            <EyeOff className="h-4 w-4 mr-2" />
            {t("runs.removal.entry")}
          </Button>
          <Button variant="destructive" disabled={busy || !canDelete} onClick={() => onChoose("everything")}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
            {t("runs.removal.everything")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
