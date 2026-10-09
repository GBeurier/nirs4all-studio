import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return usePredictionDeletionAction({
    validate: () => (!workspaceId || !chainId ? t("results.scores.delete.missingIdentifier") : null),
    deleteRequest: () => deleteScope === "group"
      ? deleteWorkspacePredictionGroup(workspaceId!, chainId, foldId || "")
      : deleteWorkspaceChainPredictions(workspaceId!, chainId),
    onDeleted,
  });
}
