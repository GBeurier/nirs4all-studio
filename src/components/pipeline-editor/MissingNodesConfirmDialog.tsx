import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  groupMissingIssuesByPipeline,
  type MissingOperatorIssue,
} from "@/lib/pipelineOperatorAvailability";

export interface MissingNodesConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: MissingOperatorIssue[];
  onConfirm: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
}

export function MissingNodesConfirmDialog({
  open,
  onOpenChange,
  issues,
  onConfirm,
  title,
  description,
  confirmLabel,
}: MissingNodesConfirmDialogProps) {
  const { t } = useTranslation();
  const groupedIssues = groupMissingIssuesByPipeline(issues);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {title ?? t("pipelineEditor.shared.missingNodes.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>{description ?? t("pipelineEditor.shared.missingNodes.description")}</AlertDialogDescription>
        </AlertDialogHeader>

        <ScrollArea className="max-h-72 rounded-md border bg-muted/20 p-3">
          <div className="space-y-3">
            {groupedIssues.map(({ pipelineName, issues: pipelineIssues }) => (
              <div key={pipelineName} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{pipelineName}</div>
                  <Badge variant="outline">{t("pipelineEditor.shared.missingNodes.missingCount", { count: pipelineIssues.length })}</Badge>
                </div>
                <div className="space-y-1">
                  {pipelineIssues.map((issue, index) => (
                    <div key={`${pipelineName}-${issue.details?.step_id ?? issue.details?.step_name ?? index}`} className="rounded-md border bg-background px-2 py-1.5">
                      <div className="text-xs font-medium">
                        {issue.details?.step_name ?? t("pipelineEditor.shared.missingNodes.unknownOperator")}
                        {issue.details?.step_type ? (
                          <span className="ml-2 text-muted-foreground">({issue.details.step_type})</span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {issue.details?.error ?? issue.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel ?? t("pipelineEditor.shared.missingNodes.confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default MissingNodesConfirmDialog;
