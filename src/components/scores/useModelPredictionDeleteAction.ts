import {
  deleteWorkspaceChainPredictions,
  deleteWorkspacePredictionGroup,
} from "@/api/linkedWorkspaces";
import type { ModelActionDeleteScope } from "@/lib/modelActionMenuData";
import { usePredictionDeletionAction } from "./usePredictionDeletionAction";

interface UseModelPredictionDeleteActionInput {
  chainId: string;
  deleteScope?: ModelActionDeleteScope;
  foldId?: string;
  workspaceId?: string;
  onDeleted?: () => void;
}

export function useModelPredictionDeleteAction({
  chainId,
  deleteScope,
  foldId,
  workspaceId,
  onDeleted,
}: UseModelPredictionDeleteActionInput) {
  return usePredictionDeletionAction({
    validate: () => (!workspaceId || !chainId ? "Missing workspace or chain identifier" : null),
    deleteRequest: () => deleteScope === "group"
      ? deleteWorkspacePredictionGroup(workspaceId!, chainId, foldId || "")
      : deleteWorkspaceChainPredictions(workspaceId!, chainId),
    onDeleted,
    failureMessage: "Deletion failed",
  });
}
