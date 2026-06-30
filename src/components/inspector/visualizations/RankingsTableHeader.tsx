import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RANKINGS_TABLE_COLUMNS } from '@/lib/inspector/rankingsTablePresentation';
import type { RankingSortField, RankingSortState } from '@/lib/inspector/rankingsTableData';

interface RankingsTableHeaderProps {
  sort: RankingSortState | null;
  onSort: (field: RankingSortField) => void;
}

export function RankingsTableHeader({
  sort,
  onSort,
}: RankingsTableHeaderProps) {
  return (
    <thead className="sticky top-0 z-10 bg-card">
      <tr className="border-b border-border">
        <th className="w-3 px-0" />
        {RANKINGS_TABLE_COLUMNS.map((column) => (
          <th
            key={column.field}
            className={cn(
              'cursor-pointer select-none px-2 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground',
              column.align === 'right' ? 'text-right' : 'text-left',
              column.width,
            )}
            onClick={() => onSort(column.field)}
          >
            <div className={cn('inline-flex items-center gap-0.5', column.align === 'right' && 'justify-end')}>
              {column.label}
              {sort?.field === column.field && (
                sort.asc
                  ? <ArrowUp className="h-3 w-3" />
                  : <ArrowDown className="h-3 w-3" />
              )}
            </div>
          </th>
        ))}
      </tr>
    </thead>
  );
}
