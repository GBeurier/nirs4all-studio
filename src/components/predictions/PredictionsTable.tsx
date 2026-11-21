import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent text-[11px]">
              <TableHead className="w-8">#</TableHead>
              <SortableHeader field="card_type" sortField={sortField} sortOrder={sortOrder} onSort={onSort}>{t("predictions.table.type")}</SortableHeader>
              <SortableHeader field="model_name" sortField={sortField} sortOrder={sortOrder} onSort={onSort}>{t("predictions.table.model")}</SortableHeader>
              <SortableHeader field="dataset_name" sortField={sortField} sortOrder={sortOrder} onSort={onSort}>{t("predictions.table.dataset")}</SortableHeader>
              <SortableHeader field="preproc" sortField={sortField} sortOrder={sortOrder} onSort={onSort}>{t("predictions.table.preprocShort")}</SortableHeader>
              <SortableHeader field="test_score" sortField={sortField} sortOrder={sortOrder} onSort={onSort} align="right" className="text-right">{primaryMetricLabel}</SortableHeader>
              <SortableHeader field="val_score" sortField={sortField} sortOrder={sortOrder} onSort={onSort} align="right" className="text-right">{t("predictions.table.valShort")}</SortableHeader>
              <SortableHeader field="fold" sortField={sortField} sortOrder={sortOrder} onSort={onSort} align="right" className="text-right">{t("predictions.table.fold")}</SortableHeader>
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
                  {t("predictions.table.noMatch")}
                </td>
              </TableRow>
            ) : (
              pageRows.map((row, index) => {
                const key = JSON.stringify([row.chainId, row.foldId, row.id]);
                const expanded = expandedRows.has(key);
                const toggle = row.children?.length ? () => setExpandedRows(current => {
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                }) : undefined;
                return (
                  <Fragment key={key}>
                    <ScoreCardRowView
                      row={row}
                      selectedMetrics={selectedMetrics}
                      workspaceId={workspaceId}
                      rank={startIndex + index + 1}
                      variant="table-row"
                      expanded={expanded}
                      onToggleExpand={toggle}
                      onViewPrediction={onViewPrediction}
                      onViewDetails={() => onViewDetails(row)}
                    />
                    {expanded && row.children?.map(child => (
                      <ScoreCardRowView
                        key={child.id}
                        row={child}
                        selectedMetrics={selectedMetrics}
                        workspaceId={workspaceId}
                        variant="table-row"
                        onViewPrediction={onViewPrediction}
                        onViewDetails={() => onViewDetails(child)}
                      />
                    ))}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
