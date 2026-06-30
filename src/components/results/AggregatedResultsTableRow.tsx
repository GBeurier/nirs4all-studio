import { Award } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { ModelActionMenu } from "@/components/scores/ModelActionMenu";
import { ModelTreeView } from "@/components/scores/ModelTreeView";
import { cn } from "@/lib/utils";
import { formatAggregatedScore } from "@/lib/aggregatedResultsData";
import type {
  ChainSummary,
  PartitionPrediction,
} from "@/types/aggregated-predictions";

interface AggregatedResultsTableRowProps {
  prediction: ChainSummary;
  hasRefit: boolean;
  isExpanded: boolean;
  workspaceId?: string;
  onExpandedChainChange: (chainId: string | null) => void;
  onViewChart: (prediction: ChainSummary) => void;
  onViewDetails: (prediction: ChainSummary) => void;
  onDeleted: () => void;
  onViewPrediction: (predictionId: string, siblings: PartitionPrediction[]) => void;
}

export function AggregatedResultsTableRow({
  prediction,
  hasRefit,
  isExpanded,
  workspaceId,
  onExpandedChainChange,
  onViewChart,
  onViewDetails,
  onDeleted,
  onViewPrediction,
}: AggregatedResultsTableRowProps) {
  const toggleExpanded = () => onExpandedChainChange(isExpanded ? null : prediction.chain_id);
  return (
    <Collapsible open={isExpanded} onOpenChange={toggleExpanded}>
      <CollapsibleTrigger asChild>
        <TableRow className={cn("cursor-pointer hover:bg-accent/50 text-sm", isExpanded && "bg-primary/5")}>
          <TableCell>
            <div>
              <div className={cn("font-medium", hasRefit && "flex items-center gap-1.5")}>
                {hasRefit && <Award className="h-3 w-3 text-emerald-500 shrink-0" />}
                {prediction.model_name ?? "\u2014"}
              </div>
              <div className="text-xs text-muted-foreground">{prediction.preprocessings || "\u2014"}</div>
            </div>
          </TableCell>
          <TableCell>{prediction.dataset_name}</TableCell>
          <TableCell><Badge variant="outline" className="text-xs">{prediction.metric}</Badge></TableCell>
          <TableCell className="text-right tabular-nums font-medium">{formatAggregatedScore(prediction.cv_val_score)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatAggregatedScore(prediction.cv_test_score)}</TableCell>
          <TableCell className={cn("text-right tabular-nums", !hasRefit && "text-muted-foreground")}>
            {hasRefit ? (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {formatAggregatedScore(prediction.final_test_score)}
              </span>
            ) : (
              "\u2014"
            )}
          </TableCell>
          <TableCell className="text-center">{prediction.cv_fold_count}</TableCell>
          <TableCell onClick={(event) => event.stopPropagation()}>
            <ModelActionMenu
              chainId={prediction.chain_id}
              modelName={prediction.model_name || ""}
              datasetName={prediction.dataset_name || ""}
              runId={prediction.run_id}
              hasRefit={hasRefit}
              workspaceId={workspaceId}
              deleteScope="chain"
              onViewChart={() => { onViewChart(prediction); }}
              onViewDetails={() => { onViewDetails(prediction); }}
              onDeleted={onDeleted}
            />
          </TableCell>
        </TableRow>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <tr>
          <td colSpan={8} className="p-0">
            <div className="border-t bg-muted/10 p-3">
              <ModelTreeView
                chainId={prediction.chain_id}
                selectedMetrics={[prediction.metric || "rmse"]}
                metric={prediction.metric || null}
                foldArtifacts={prediction.fold_artifacts}
                onViewPrediction={onViewPrediction}
                onViewDetails={() => { onViewDetails(prediction); }}
              />
            </div>
          </td>
        </tr>
      </CollapsibleContent>
    </Collapsible>
  );
}
