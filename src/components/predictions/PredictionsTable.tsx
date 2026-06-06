import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScoreCardRowView } from "@/components/scores/ScoreCardRowView";
import { SortableHeader } from "@/components/predictions/SortableHeader";
import { getMetricAbbreviation } from "@/lib/scores";
import type { SortField, SortOrder } from "@/lib/predictions/rows";
import type { ScoreCardRow } from "@/types/score-cards";

interface PredictionsTableProps {
  pageRows: ScoreCardRow[];
  selectedMetrics: string[];
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  primaryMetricLabel: string;
  workspaceId: string;
  startIndex: number;
  onViewPrediction: (predictionId: string) => void;
  onViewDetails: (row: ScoreCardRow) => void;
}

export function PredictionsTable({
  pageRows,
  selectedMetrics,
  sortField,
  sortOrder,
  onSort,
  primaryMetricLabel,
  workspaceId,
  startIndex,
  onViewPrediction,
  onViewDetails,
}: PredictionsTableProps) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent text-[11px]">
              <TableHead className="w-8">#</TableHead>
              <SortableHeader field="card_type" sortField={sortField} sortOrder={sortOrder} onSort={onSort}>Type</SortableHeader>
              <SortableHeader field="model_name" sortField={sortField} sortOrder={sortOrder} onSort={onSort}>Model</SortableHeader>
              <SortableHeader field="dataset_name" sortField={sortField} sortOrder={sortOrder} onSort={onSort}>Dataset</SortableHeader>
              <SortableHeader field="preproc" sortField={sortField} sortOrder={sortOrder} onSort={onSort}>Preproc</SortableHeader>
              <SortableHeader field="test_score" sortField={sortField} sortOrder={sortOrder} onSort={onSort} align="right" className="text-right">{primaryMetricLabel}</SortableHeader>
              <SortableHeader field="val_score" sortField={sortField} sortOrder={sortOrder} onSort={onSort} align="right" className="text-right">Val</SortableHeader>
              <SortableHeader field="fold" sortField={sortField} sortOrder={sortOrder} onSort={onSort} align="right" className="text-right">Fold</SortableHeader>
              {selectedMetrics.map(metric => (
                <SortableHeader
                  key={metric}
                  field={`metric:${metric}` as SortField}
                  sortField={sortField}
                  sortOrder={sortOrder}
                  onSort={onSort}
                  align="right"
                  className="text-right"
                >
                  <span className="text-[10px]">{getMetricAbbreviation(metric)}</span>
                </SortableHeader>
              ))}
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <td colSpan={100} className="text-center py-8 text-muted-foreground text-sm">
                  No models match your filters
                </td>
              </TableRow>
            ) : (
              pageRows.map((row, index) => (
                <ScoreCardRowView
                  key={`${row.chainId}-${row.foldId}-${row.id}`}
                  row={row}
                  selectedMetrics={selectedMetrics}
                  workspaceId={workspaceId}
                  rank={startIndex + index + 1}
                  variant="table-row"
                  onViewPrediction={onViewPrediction}
                  onViewDetails={() => onViewDetails(row)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
