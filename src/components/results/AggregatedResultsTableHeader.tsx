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
  return (
    <TableHeader>
      <TableRow>
        <SortableHead columnKey="model" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort}>
          Model
        </SortableHead>
        <SortableHead columnKey="dataset" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort}>
          Dataset
        </SortableHead>
        <SortableHead columnKey="metric" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort}>
          Metric
        </SortableHead>
        <SortableHead columnKey="cv_val" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort} align="right">
          CV Val
        </SortableHead>
        <SortableHead columnKey="cv_test" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort} align="right">
          CV Test
        </SortableHead>
        <SortableHead columnKey="final_test" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort} align="right">
          Final
        </SortableHead>
        <SortableHead columnKey="folds" sortKey={sortKey} sortAsc={sortAsc} onSort={onSort} align="center">
          Folds
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
