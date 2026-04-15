import { AlertTriangle } from "lucide-react";
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
  title = "Launch without missing nodes?",
  description = "The missing nodes will be removed from a temporary launch copy of the pipeline. Your saved pipeline stays unchanged.",
  confirmLabel = "Launch Without Missing Nodes",
}: MissingNodesConfirmDialogProps) {
  const groupedIssues = groupMissingIssuesByPipeline(issues);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <ScrollArea className="max-h-72 rounded-md border bg-muted/20 p-3">
          <div className="space-y-3">
            {groupedIssues.map(({ pipelineName, issues: pipelineIssues }) => (
              <div key={pipelineName} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{pipelineName}</div>
                  <Badge variant="outline">{pipelineIssues.length} missing</Badge>
                </div>
                <div className="space-y-1">
                  {pipelineIssues.map((issue, index) => (
                    <div key={`${pipelineName}-${issue.details?.step_id ?? issue.details?.step_name ?? index}`} className="rounded-md border bg-background px-2 py-1.5">
                      <div className="text-xs font-medium">
                        {issue.details?.step_name ?? "Unknown operator"}
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
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default MissingNodesConfirmDialog;
