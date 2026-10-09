import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import {
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AggregatedResultsSortKey } from "@/lib/aggregatedResultsData";

interface AggregatedResultsTableHeaderProps {
  sortKey: AggregatedResultsSortKey;
  sortAsc: boolean;
  onSort: (key: AggregatedResultsSortKey) => void;
}

export function AggregatedResultsTableHeader({
  sortKey,
  sortAsc,
  onSort,
}: AggregatedResultsTableHeaderProps) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        <SortableHead columnKey="model" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort}>
          {t("aggregatedResults.columns.model")}
        </SortableHead>
        <SortableHead columnKey="dataset" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort}>
          {t("aggregatedResults.columns.dataset")}
        </SortableHead>
        <SortableHead columnKey="metric" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort}>
          {t("aggregatedResults.columns.metric")}
        </SortableHead>
        <SortableHead columnKey="cv_val" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort} align="right">
          {t("aggregatedResults.columns.cvVal")}
        </SortableHead>
        <SortableHead columnKey="cv_test" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort} align="right">
          {t("aggregatedResults.columns.cvTest")}
        </SortableHead>
        <SortableHead columnKey="final_test" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort} align="right">
          {t("aggregatedResults.columns.final")}
        </SortableHead>
        <SortableHead columnKey="folds" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort} align="center">
          {t("aggregatedResults.columns.folds")}
        </SortableHead>
        <TableHead className="w-20" />
      </TableRow>
    </TableHeader>
  );
}

function SortableHead({
  columnKey,
  sortKey,
  sortAsc,
  align,
  onSort,
  children,
}: {
  columnKey: AggregatedResultsSortKey;
  sortKey: AggregatedResultsSortKey;
  sortAsc: boolean;
  align?: "right" | "center";
  onSort: (key: AggregatedResultsSortKey) => void;
  children: React.ReactNode;
}) {
  return (
    <TableHead
      className={cn(
        "cursor-pointer hover:text-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
      )}
      onClick={() => onSort(columnKey)}
    >
      {children} <SortIcon active={sortKey === columnKey} ascending={sortAsc} />
    </TableHead>
  );
}

function SortIcon({ active, ascending }: { active: boolean; ascending: boolean }) {
  if (!active) return null;
  return ascending ? (
    <ArrowUp className="h-3 w-3 inline ml-0.5" />
  ) : (
    <ArrowDown className="h-3 w-3 inline ml-0.5" />
  );
}
