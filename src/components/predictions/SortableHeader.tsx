import { ArrowUpDown } from "lucide-react";

import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortField, SortOrder } from "@/lib/predictions/rows";

interface SortableHeaderProps {
  field: SortField;
  children: React.ReactNode;
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
  align?: "left" | "right";
  className?: string;
}

export function SortableHeader({
  field,
  children,
  sortField,
  sortOrder,
  onSort,
  align = "left",
  className,
}: SortableHeaderProps) {
  return (
    <TableHead
      className={cn("cursor-pointer hover:text-foreground transition-colors select-none", className)}
      onClick={() => onSort(field)}
    >
      <div className={cn("flex items-center gap-1", align === "right" && "justify-end")}>
        {align === "right" && sortField === field && <ArrowUpDown className={cn("h-3 w-3", sortOrder === "asc" && "rotate-180")} />}
        {children}
        {align !== "right" && sortField === field && <ArrowUpDown className={cn("h-3 w-3", sortOrder === "asc" && "rotate-180")} />}
      </div>
    </TableHead>
  );
}
