import { useState } from "react";
import { Loader2 } from "lucide-react";
import { getScoreCardCrossvalChildren } from "@/lib/scoreCardTreeData";
import type { PartitionPrediction } from "@/types/aggregated-predictions";
import type { ScoreCardRow } from "@/types/score-cards";
import { ScoreCardRowView } from "./ScoreCardRowView";
import { useScoreCardChainDetail } from "./useScoreCardChainDetail";

export interface ScoreCardExpandableRowCallbacks {
  onViewDetails?: (row: ScoreCardRow) => void;
  onViewPrediction?: (predictionId: string, prediction?: PartitionPrediction) => void;
}

interface ScoreCardExpandableRowProps extends ScoreCardExpandableRowCallbacks {
  row: ScoreCardRow;
  selectedMetrics: string[];
  workspaceId?: string;
  rank?: number;
  variant: "card" | "table";
  maxTableMetrics?: number;
  defaultExpanded?: boolean;
}

interface CrossvalExpandableRowProps extends ScoreCardExpandableRowProps {
  indent?: number;
}

export function CrossvalExpandableRow({
  row,
  selectedMetrics,
  workspaceId,
  rank,
  variant,
  onViewDetails,
  onViewPrediction,
  maxTableMetrics,
  indent = 0,
  defaultExpanded = false,
}: CrossvalExpandableRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const {
    isLoading,
    trainChildren,
    displayRow,
    handleViewPrediction,
    handleViewChainChart,
  } = useScoreCardChainDetail({
    row,
    onViewPrediction,
    includeTrainChildren: true,
    enrichCrossval: true,
  });
  const toggleExpanded = () => setExpanded((current) => !current);

  if (variant === "card") {
    return (
      <div>
        <ScoreCardRowView
          row={displayRow}
          selectedMetrics={selectedMetrics}
          workspaceId={workspaceId}
          rank={rank}
          variant="inline"
          expandable
          expanded={expanded}
          onToggleExpand={toggleExpanded}
          onViewDetails={onViewDetails ? () => onViewDetails(displayRow) : undefined}
          onViewChart={onViewPrediction ? handleViewChainChart : undefined}
          indent={indent}
        />
        {expanded && (
          <div className="ml-6 mt-0.5 space-y-0.5 border-l-2 border-border/30 pl-2">
            <ScoreCardTrainChildren
              isLoading={isLoading}
              trainChildren={trainChildren}
              selectedMetrics={selectedMetrics}
              workspaceId={workspaceId}
              onViewDetails={onViewDetails}
              onViewPrediction={onViewPrediction ? handleViewPrediction : undefined}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <ScoreCardRowView
        row={displayRow}
        selectedMetrics={selectedMetrics}
        workspaceId={workspaceId}
        rank={rank}
        variant="table-row"
        expandable
        expanded={expanded}
        onToggleExpand={toggleExpanded}
        onViewDetails={onViewDetails ? () => onViewDetails(displayRow) : undefined}
        onViewChart={onViewPrediction ? handleViewChainChart : undefined}
        maxTableMetrics={maxTableMetrics}
      />
      {expanded && (
        <tr>
          <td colSpan={100} className="p-0">
            <div className="border-t bg-muted/10 px-4 py-2 space-y-0.5 ml-8 border-l-2 border-border/30">
              <ScoreCardTrainChildren
                isLoading={isLoading}
                trainChildren={trainChildren}
                selectedMetrics={selectedMetrics}
                workspaceId={workspaceId}
                onViewDetails={onViewDetails}
                onViewPrediction={onViewPrediction ? handleViewPrediction : undefined}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function RefitExpandableRow({
  row,
  selectedMetrics,
  workspaceId,
  rank,
  variant,
  onViewDetails,
  onViewPrediction,
  maxTableMetrics,
  defaultExpanded = false,
}: ScoreCardExpandableRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const crossvalChildren = getScoreCardCrossvalChildren(row);
  const { handleViewChainChart } = useScoreCardChainDetail({ row, onViewPrediction });
  const toggleExpanded = () => setExpanded((current) => !current);

  if (variant === "card") {
    return (
      <div>
        <ScoreCardRowView
          row={row}
          selectedMetrics={selectedMetrics}
          workspaceId={workspaceId}
          rank={rank}
          variant="inline"
          expandable
          expanded={expanded}
          onToggleExpand={toggleExpanded}
          onViewDetails={onViewDetails ? () => onViewDetails(row) : undefined}
          onViewChart={onViewPrediction ? handleViewChainChart : undefined}
        />
        {expanded && (
          <div className="ml-4 mt-0.5 space-y-0.5">
            <ScoreCardCrossvalChildren
              crossvalChildren={crossvalChildren}
              selectedMetrics={selectedMetrics}
              workspaceId={workspaceId}
              variant="card"
              onViewDetails={onViewDetails}
              onViewPrediction={onViewPrediction}
              maxTableMetrics={maxTableMetrics}
              indent={1}
              defaultExpanded
              emptyClassName="ml-2"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <ScoreCardRowView
        row={row}
        selectedMetrics={selectedMetrics}
        workspaceId={workspaceId}
        rank={rank}
        variant="table-row"
        expandable
        expanded={expanded}
        onToggleExpand={toggleExpanded}
        onViewDetails={onViewDetails ? () => onViewDetails(row) : undefined}
        onViewChart={onViewPrediction ? handleViewChainChart : undefined}
        maxTableMetrics={maxTableMetrics}
      />
      {expanded && (
        <tr>
          <td colSpan={100} className="p-0">
            <div className="border-t bg-muted/10 px-4 py-2 space-y-1">
              <ScoreCardCrossvalChildren
                crossvalChildren={crossvalChildren}
                selectedMetrics={selectedMetrics}
                workspaceId={workspaceId}
                variant="card"
                onViewDetails={onViewDetails}
                onViewPrediction={onViewPrediction}
                maxTableMetrics={maxTableMetrics}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ScoreCardCrossvalChildren({
  crossvalChildren,
  selectedMetrics,
  workspaceId,
  variant,
  onViewDetails,
  onViewPrediction,
  maxTableMetrics,
  indent,
  defaultExpanded,
  emptyClassName,
}: ScoreCardExpandableRowCallbacks & {
  crossvalChildren: ScoreCardRow[];
  selectedMetrics: string[];
  workspaceId?: string;
  variant: "card" | "table";
  maxTableMetrics?: number;
  indent?: number;
  defaultExpanded?: boolean;
  emptyClassName?: string;
}) {
  if (crossvalChildren.length === 0) {
    return (
      <div className={["text-xs text-muted-foreground py-1", emptyClassName].filter(Boolean).join(" ")}>
        No CV data
      </div>
    );
  }

  return (
    <>
      {crossvalChildren.map((cvRow) => (
        <CrossvalExpandableRow
          key={cvRow.id}
          row={cvRow}
          selectedMetrics={selectedMetrics}
          workspaceId={workspaceId}
          variant={variant}
          onViewDetails={onViewDetails}
          onViewPrediction={onViewPrediction}
          maxTableMetrics={maxTableMetrics}
          indent={indent}
          defaultExpanded={defaultExpanded}
        />
      ))}
    </>
  );
}

function ScoreCardTrainChildren({
  isLoading,
  trainChildren,
  selectedMetrics,
  workspaceId,
  onViewDetails,
  onViewPrediction,
}: ScoreCardExpandableRowCallbacks & {
  isLoading: boolean;
  trainChildren: ScoreCardRow[];
  selectedMetrics: string[];
  workspaceId?: string;
}) {
  return (
    <>
      {isLoading && (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading folds...
        </div>
      )}
      {trainChildren.map((child) => (
        <ScoreCardRowView
          key={child.id}
          row={child}
          selectedMetrics={selectedMetrics}
          workspaceId={workspaceId}
          variant="inline"
          onViewPrediction={onViewPrediction}
          onViewDetails={onViewDetails ? () => onViewDetails(child) : undefined}
        />
      ))}
      {!isLoading && trainChildren.length === 0 && (
        <div className="text-xs text-muted-foreground py-1">No fold data</div>
      )}
    </>
  );
}
