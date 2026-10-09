import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
} from "@/components/ui/table";
import type { AggregatedResultsSortKey } from "@/lib/aggregatedResultsData";
import type {
  ChainSummary,
  PartitionPrediction,
} from "@/types/aggregated-predictions";
import { AggregatedResultsSectionHeader } from "./AggregatedResultsSectionHeader";
import { AggregatedResultsTableHeader } from "./AggregatedResultsTableHeader";
import { AggregatedResultsTableRow } from "./AggregatedResultsTableRow";

interface AggregatedResultsTableProps {
  filteredCount: number;
  totalCount: number;
  refitPredictions: ChainSummary[];
  cvPredictions: ChainSummary[];
  sortKey: AggregatedResultsSortKey;
  sortAsc: boolean;
  expandedChainId: string | null;
  workspaceId?: string;
  onSort: (key: AggregatedResultsSortKey) => void;
  onExpandedChainChange: (chainId: string | null) => void;
  onViewChart: (prediction: ChainSummary) => void;
  onViewDetails: (prediction: ChainSummary) => void;
  onDeleted: () => void;
  onViewPrediction: (predictionId: string, siblings: PartitionPrediction[]) => void;
}

export function AggregatedResultsTable({
  filteredCount,
  totalCount,
  refitPredictions,
  cvPredictions,
  sortKey,
  sortAsc,
  expandedChainId,
  workspaceId,
  onSort,
  onExpandedChainChange,
  onViewChart,
  onViewDetails,
  onDeleted,
  onViewPrediction,
}: AggregatedResultsTableProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {t("aggregatedResults.table.count", { filtered: filteredCount, count: totalCount })}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <AggregatedResultsTableHeader sortKey={sortKey} sortAsc={sortAsc} onSort={onSort} />
          <TableBody>
            <AggregatedResultsSectionHeader
              label={t("aggregatedResults.table.refit")}
              count={refitPredictions.length}
              variant="refit"
            />
            {refitPredictions.map((prediction) => (
              <AggregatedResultsTableRow
                key={`${prediction.chain_id}-${prediction.metric}-${prediction.dataset_name}`}
                prediction={prediction}
                hasRefit
                isExpanded={expandedChainId === prediction.chain_id}
                workspaceId={workspaceId}
                onExpandedChainChange={onExpandedChainChange}
                onViewChart={onViewChart}
                onViewDetails={onViewDetails}
                onDeleted={onDeleted}
                onViewPrediction={onViewPrediction}
              />
            ))}
            <AggregatedResultsSectionHeader
              label={t("aggregatedResults.table.cv")}
              count={cvPredictions.length}
              variant="cv"
            />
            {cvPredictions.map((prediction) => (
              <AggregatedResultsTableRow
                key={`${prediction.chain_id}-${prediction.metric}-${prediction.dataset_name}`}
                prediction={prediction}
                hasRefit={false}
                isExpanded={expandedChainId === prediction.chain_id}
                workspaceId={workspaceId}
                onExpandedChainChange={onExpandedChainChange}
                onViewChart={onViewChart}
                onViewDetails={onViewDetails}
                onDeleted={onDeleted}
                onViewPrediction={onViewPrediction}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
