/**
 * RankingsTable — Interactive rankings table for Inspector.
 *
 * HTML table with sortable columns, row selection, and group color indicators.
 */

import { useMemo, useCallback, useState } from 'react';
import { ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { useInspectorHover } from '@/context/InspectorSelectionContext';
import type { RankingsResponse, InspectorGroup } from '@/types/inspector';

interface RankingsTableProps {
  data: RankingsResponse | null | undefined;
  groups: InspectorGroup[];
  isLoading: boolean;
}

type SortField = 'rank' | 'model_class' | 'preprocessings' | 'cv_val_score' | 'cv_test_score' | 'final_test_score' | 'cv_fold_count' | 'dataset_name';

function formatScore(val: number | null | undefined): string {
  if (val == null) return '—';
  return val.toFixed(4);
}

export function RankingsTable({ data, groups, isLoading }: RankingsTableProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();
  const { hoveredChain, setHovered } = useInspectorHover();
  const [localSort, setLocalSort] = useState<{ field: SortField; asc: boolean } | null>(null);

  // Chain→color lookup
  const chainColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      for (const cid of group.chain_ids) map.set(cid, group.color);
    }
    return map;
  }, [groups]);

  // Sort locally if user clicked a header
  const sortedRankings = useMemo(() => {
    if (!data?.rankings) return [];
    if (!localSort) return data.rankings;

    const rows = [...data.rankings];
    rows.sort((a, b) => {
      const aVal = a[localSort.field as keyof typeof a];
      const bVal = b[localSort.field as keyof typeof b];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return localSort.asc ? aVal - bVal : bVal - aVal;
      }
      return localSort.asc
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return rows;
  }, [data?.rankings, localSort]);

  const handleSort = useCallback((field: SortField) => {
    setLocalSort(prev => {
      if (prev?.field === field) return { field, asc: !prev.asc };
      // Default: ascending for strings, descending for scores
      const defaultAsc = ['model_class', 'preprocessings', 'dataset_name', 'rank'].includes(field);
      return { field, asc: defaultAsc };
    });
  }, []);

  const handleRowClick = useCallback((chainId: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      select([chainId], 'add');
    } else if (e.ctrlKey || e.metaKey) {
      select([chainId], 'toggle');
    } else {
      // If clicking the only selected chain, deselect
      if (selectedChains.size === 1 && selectedChains.has(chainId)) {
        select([], 'replace');
      } else {
        select([chainId], 'replace');
      }
    }
  }, [select, selectedChains]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading rankings...</span>
      </div>
    );
  }

  if (sortedRankings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No ranking data available.
      </div>
    );
  }

  const columns: { field: SortField; label: string; align?: 'left' | 'right'; width?: string }[] = [
    { field: 'rank', label: '#', align: 'right', width: 'w-10' },
    { field: 'model_class', label: 'Model' },
    { field: 'preprocessings', label: 'Preprocessing' },
    { field: 'cv_val_score', label: 'Val Score', align: 'right' },
    { field: 'cv_test_score', label: 'Test Score', align: 'right' },
    { field: 'final_test_score', label: 'Final Test', align: 'right' },
    { field: 'cv_fold_count', label: 'Folds', align: 'right', width: 'w-14' },
    { field: 'dataset_name', label: 'Dataset' },
  ];

  return (
    <div className="w-full h-full overflow-auto">
      <table className="text-xs border-collapse min-w-[600px]">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border">
            {/* Color indicator column */}
            <th className="w-3 px-0" />
            {columns.map(col => (
              <th
                key={col.field}
                className={cn(
                  'px-2 py-1.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none',
                  col.align === 'right' ? 'text-right' : 'text-left',
                  col.width,
                )}
                onClick={() => handleSort(col.field)}
              >
                <div className={cn('inline-flex items-center gap-0.5', col.align === 'right' && 'justify-end')}>
                  {col.label}
                  {localSort?.field === col.field && (
                    localSort.asc
                      ? <ArrowUp className="w-3 h-3" />
                      : <ArrowDown className="w-3 h-3" />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRankings.map(row => {
            const chainId = row.chain_id;
            const isSelected = hasSelection && selectedChains.has(chainId);
            const isHovered = hoveredChain === chainId;
            const dimmed = hasSelection && !isSelected;
            const color = chainColorMap.get(chainId) ?? '#64748b';

            return (
              <tr
                key={chainId}
                className={cn(
                  'border-b border-border/30 cursor-pointer transition-colors',
                  isSelected && 'bg-primary/10',
                  isHovered && 'bg-muted/50',
                  dimmed && !isHovered && 'opacity-40',
                  !isSelected && !isHovered && !dimmed && 'hover:bg-muted/30',
                )}
                onClick={(e) => handleRowClick(chainId, e)}
                onMouseEnter={() => setHovered(chainId)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Color indicator */}
                <td className="px-0">
                  <div
                    className="w-1 h-4 rounded-full mx-auto"
                    style={{ backgroundColor: color }}
                  />
                </td>

                <td className="px-2 py-1.5 text-right text-muted-foreground">{row.rank}</td>
                <td className="px-2 py-1.5 font-medium truncate" title={row.model_class}>
                  {row.model_name ?? row.model_class}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground truncate" title={row.preprocessings ?? ''}>
                  {row.preprocessings ?? '—'}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{formatScore(row.cv_val_score)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatScore(row.cv_test_score)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatScore(row.final_test_score)}</td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">{row.cv_fold_count}</td>
                <td className="px-2 py-1.5 text-muted-foreground truncate" title={row.dataset_name ?? ''}>
                  {row.dataset_name ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
