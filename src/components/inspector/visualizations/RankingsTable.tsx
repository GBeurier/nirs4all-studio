/**
 * RankingsTable — Interactive rankings table for Inspector.
 *
 * HTML table with sortable columns, row selection, and group color indicators.
 */

import { useMemo, useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection, useInspectorHover } from '@/context/useInspectorSelection';
import {
  buildRankingChainColorMap,
  getNextRankingSort,
  getRankingRowSelectionDecision,
  getRankingRowVisualState,
  sortRankings,
} from '@/lib/inspector/rankingsTableData';
import { getRankingsTableEmptyMessage } from '@/lib/inspector/rankingsTablePresentation';
import type { RankingsResponse, InspectorGroup } from '@/types/inspector';
import type { RankingSortField, RankingSortState } from '@/lib/inspector/rankingsTableData';
import { RankingsTableHeader } from './RankingsTableHeader';
import { RankingsTableRow } from './RankingsTableRow';

interface RankingsTableProps {
  data: RankingsResponse | null | undefined;
  groups: InspectorGroup[];
  isLoading: boolean;
}

export function RankingsTable({ data, groups, isLoading }: RankingsTableProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();
  const { hoveredChain, setHovered } = useInspectorHover();
  const [localSort, setLocalSort] = useState<RankingSortState | null>(null);

  // Chain→color lookup
  const chainColorMap = useMemo(() => {
    return buildRankingChainColorMap(groups);
  }, [groups]);

  // Sort locally if user clicked a header
  const sortedRankings = useMemo(() => {
    return sortRankings(data?.rankings, localSort);
  }, [data?.rankings, localSort]);

  const handleSort = useCallback((field: RankingSortField) => {
    setLocalSort(prev => getNextRankingSort(prev, field));
  }, []);

  const handleRowClick = useCallback((chainId: string, e: React.MouseEvent) => {
    const decision = getRankingRowSelectionDecision({
      chainId,
      modifiers: e,
      selectedChains,
    });
    select(decision.chainIds, decision.mode);
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
        {getRankingsTableEmptyMessage()}
      </div>
    );
  }
  return (
    <div className="w-full h-full overflow-auto">
      <table className="text-xs border-collapse min-w-[600px]">
        <RankingsTableHeader sort={localSort} onSort={handleSort} />
        <tbody>
          {sortedRankings.map(row => {
            const rowState = getRankingRowVisualState({
              row,
              selectedChains,
              hasSelection,
              hoveredChain,
              chainColorMap,
            });

            return (
              <RankingsTableRow
                key={rowState.chainId}
                row={row}
                rowState={rowState}
                onRowClick={handleRowClick}
                onHoverChainChange={setHovered}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
