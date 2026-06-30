import { Link } from "react-router-dom";
import { Eye, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell } from "@/components/ui/table";
import type { ScoreCardRow } from "@/types/score-cards";
import { ModelActionMenu } from "./ModelActionMenu";

interface ScoreCardRowActionProps {
  row: ScoreCardRow;
  workspaceId?: string;
  onViewDetails?: () => void;
  onViewPrediction?: (predictionId: string) => void;
  onViewChart?: () => void;
}

interface InlineScoreCardRowActionsProps extends ScoreCardRowActionProps {
  isRefit: boolean;
  isTrain: boolean;
}

export function InlineScoreCardRowActions({
  row,
  workspaceId,
  isRefit,
  isTrain,
  onViewDetails,
  onViewPrediction,
  onViewChart,
}: InlineScoreCardRowActionsProps) {
  return (
    <div className="mt-1 flex items-center justify-end gap-0.5 px-2 lg:mt-0 lg:px-0">
      {row.hasRefitArtifact && (
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" asChild title="Predict">
          <Link to={`/predict?model_id=${encodeURIComponent(row.predictChainId || row.chainId)}&source=chain`}>
            <Zap className="h-3 w-3 text-emerald-500" />
          </Link>
        </Button>
      )}
      {isRefit && !row.hasRefitArtifact && <span className="block h-5 w-5 shrink-0" aria-hidden="true" />}
      <ModelActionMenu
        chainId={row.chainId}
        predictChainId={row.predictChainId}
        modelName={row.modelName}
        datasetName={row.datasetName}
        runId={row.runId}
        taskType={row.taskType}
        hasRefit={row.hasRefitArtifact}
        workspaceId={workspaceId}
        deleteScope={isTrain ? "group" : "chain"}
        foldId={isTrain ? row.foldId : undefined}
        onViewDetails={onViewDetails}
        onViewChart={onViewChart ?? (onViewPrediction ? () => onViewPrediction(row.id) : undefined)}
      />
    </div>
  );
}

export function TableScoreCardRowActions({
  row,
  workspaceId,
  onViewDetails,
  onViewPrediction,
  onViewChart,
}: ScoreCardRowActionProps) {
  return (
    <TableCell onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-0.5">
        {onViewPrediction && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onViewPrediction(row.id)}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
        )}
        <ModelActionMenu
          chainId={row.chainId}
          predictChainId={row.predictChainId}
          modelName={row.modelName}
          datasetName={row.datasetName}
          runId={row.runId}
          taskType={row.taskType}
          hasRefit={row.hasRefitArtifact}
          workspaceId={workspaceId}
          deleteScope="group"
          foldId={row.foldId}
          onViewDetails={onViewDetails}
          onViewChart={onViewChart ?? (onViewPrediction ? () => onViewPrediction(row.id) : undefined)}
        />
      </div>
    </TableCell>
  );
}
