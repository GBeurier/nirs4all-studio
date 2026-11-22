import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteN4AWorkspaceRun } from "@/api/linkedWorkspaces";
import { hideRunsFromHistory } from "@/hooks/useHiddenRuns";
import { useApiErrorToast } from "@/hooks/useApiErrorToast";
import { invalidatePredictionRelatedQueries } from "@/lib/prediction-deletion";
import { getRuntimeResultStatusDisplay } from "@/ui/runtime";
import type { EnrichedRun } from "@/types/enriched-runs";
import { RunRemovalDialog, type RunRemovalChoice } from "./RunRemovalDialog";

interface ClearRunHistoryButtonProps {
  workspaceId: string | undefined;
  runs: EnrichedRun[];
}

/** Clears the Runs history, asking per run (or once for all) what to remove. */
export function ClearRunHistoryButton({ workspaceId, runs }: ClearRunHistoryButtonProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const notifyApiError = useApiErrorToast();
  const [queue, setQueue] = useState<EnrichedRun[]>([]);
  const [applyToAll, setApplyToAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const removable = runs.filter(run => !getRuntimeResultStatusDisplay(run.status).isBusy);
  const current = queue[0];

  const apply = async (choice: RunRemovalChoice) => {
    if (!workspaceId || !current) return;
    const targets = applyToAll ? queue : [current];
    let failed = failures;
    if (choice === "entry") {
      hideRunsFromHistory(workspaceId, targets.map(run => run.run_id));
    } else {
      setBusy(true);
      for (const run of targets) {
        try {
          await deleteN4AWorkspaceRun(workspaceId, run.run_id);
        } catch (error) {
          failed += 1;
          notifyApiError(error, t("errors.action.deleteRun"));
        }
      }
      await invalidatePredictionRelatedQueries(queryClient);
      setBusy(false);
    }
    const rest = queue.slice(targets.length);
    setQueue(rest);
    setFailures(failed);
    if (rest.length === 0) {
      setApplyToAll(false);
      setFailures(0);
      if (failed === 0) toast.success(t("runs.removal.historyCleared"));
      else toast.warning(t("runs.removal.historyPartiallyCleared", { count: failed }));
    }
  };

  return (
    <>
      <Button
        variant="outline"
        disabled={!workspaceId || removable.length === 0}
        onClick={() => { setApplyToAll(false); setFailures(0); setQueue(removable); }}
      >
        <Eraser className="h-4 w-4 mr-2" />
        {t("runs.removal.clearHistory")}
      </Button>
      <RunRemovalDialog
        open={!!current}
        runName={current ? current.name || current.run_id : ""}
        busy={busy}
        canDelete
        remainingCount={queue.length - 1}
        applyToAll={applyToAll}
        onApplyToAllChange={setApplyToAll}
        onChoose={(choice) => void apply(choice)}
        onCancel={() => { setQueue([]); setApplyToAll(false); }}
      />
    </>
  );
}
