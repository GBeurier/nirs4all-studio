import { cn } from '@/lib/utils';
import {
  formatRankingModelLabel,
  formatRankingOptionalText,
  formatRankingScore,
} from '@/lib/inspector/rankingsTablePresentation';
import type { RankingRow } from '@/types/inspector';
import type { RankingRowVisualState } from '@/lib/inspector/rankingsTableData';

interface RankingsTableRowProps {
  row: RankingRow;
  rowState: RankingRowVisualState;
  onRowClick: (chainId: string, event: React.MouseEvent) => void;
  onHoverChainChange: (chainId: string | null) => void;
}

export function RankingsTableRow({
  row,
  rowState,
  onRowClick,
  onHoverChainChange,
}: RankingsTableRowProps) {
  return (
    <tr
      className={cn(
        'cursor-pointer border-b border-border/30 transition-colors',
        rowState.isSelected && 'bg-primary/10',
        rowState.isHovered && 'bg-muted/50',
        rowState.dimmed && !rowState.isHovered && 'opacity-40',
        !rowState.isSelected && !rowState.isHovered && !rowState.dimmed && 'hover:bg-muted/30',
      )}
      onClick={(event) => onRowClick(rowState.chainId, event)}
      onMouseEnter={() => onHoverChainChange(rowState.chainId)}
      onMouseLeave={() => onHoverChainChange(null)}
    >
      <td className="px-0">
        <div
          className="mx-auto h-4 w-1 rounded-full"
          style={{ backgroundColor: rowState.color }}
        />
      </td>

      <td className="px-2 py-1.5 text-right text-muted-foreground">{row.rank}</td>
      <td className="truncate px-2 py-1.5 font-medium" title={row.model_class}>
        {formatRankingModelLabel(row)}
      </td>
      <td className="truncate px-2 py-1.5 text-muted-foreground" title={row.preprocessings ?? ''}>
        {formatRankingOptionalText(row.preprocessings)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono">{formatRankingScore(row.cv_val_score)}</td>
      <td className="px-2 py-1.5 text-right font-mono">{formatRankingScore(row.cv_test_score)}</td>
      <td className="px-2 py-1.5 text-right font-mono">{formatRankingScore(row.final_test_score)}</td>
      <td className="px-2 py-1.5 text-right text-muted-foreground">{row.cv_fold_count}</td>
      <td className="truncate px-2 py-1.5 text-muted-foreground" title={row.dataset_name ?? ''}>
        {formatRankingOptionalText(row.dataset_name)}
      </td>
    </tr>
  );
}
