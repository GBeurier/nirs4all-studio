import { useTranslation } from "react-i18next";

import { formatMetricValue } from "@/lib/scores";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  formatPredictPartitionLabel,
  type PredictTableRow,
} from "./predictResultsData";

interface PredictResultsTableProps {
  hasActuals: boolean;
  rows: PredictTableRow[];
  showPartitionColumn: boolean;
}

export function PredictResultsTable({
  hasActuals,
  rows,
  showPartitionColumn,
}: PredictResultsTableProps) {
  const { t } = useTranslation();
  const conformalCoverageLabel = rows.find(
    (row) => row.conformalCoverageLabel,
  )?.conformalCoverageLabel;
  const hasConformalBounds = conformalCoverageLabel !== undefined;

  return (
    <div className="max-h-[460px] overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">
              {t("predict.results.table.sample")}
            </TableHead>
            {showPartitionColumn && (
              <TableHead className="w-24">Partition</TableHead>
            )}
            <TableHead className="text-right">
              {t("predict.results.table.predicted")}
            </TableHead>
            {hasConformalBounds && (
              <>
                <TableHead className="text-right">{conformalCoverageLabel} lower</TableHead>
                <TableHead className="text-right">{conformalCoverageLabel} upper</TableHead>
              </>
            )}
            {hasActuals && (
              <>
                <TableHead className="text-right">
                  {t("predict.results.table.actual")}
                </TableHead>
                <TableHead className="text-right">
                  {t("predict.results.table.residual")}
                </TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              <TableCell className="font-mono text-xs">{String(row.index)}</TableCell>
              {showPartitionColumn && (
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.partition ? formatPredictPartitionLabel(row.partition) : "-"}
                </TableCell>
              )}
              <TableCell className="text-right font-mono text-sm">
                {formatMetricValue(row.predicted)}
              </TableCell>
              {hasConformalBounds && (
                <>
                  <TableCell className="text-right font-mono text-sm">
                    {row.conformalLower !== undefined ? formatMetricValue(row.conformalLower) : "–"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {row.conformalUpper !== undefined ? formatMetricValue(row.conformalUpper) : "–"}
                  </TableCell>
                </>
              )}
              {hasActuals && (
                <>
                  <TableCell className="text-right font-mono text-sm">
                    {row.actual !== undefined ? formatMetricValue(row.actual) : "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {row.residual !== undefined ? formatMetricValue(row.residual) : "-"}
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
