/**
 * GroupChip — Small badge showing group label, color dot, and chain count.
 */

import { cn } from '@/lib/utils';
import type { InspectorGroup } from '@/types/inspector';

interface GroupChipProps {
  group: InspectorGroup;
  isActive?: boolean;
  onClick?: () => void;
}

export function GroupChip({ group, isActive = false, onClick }: GroupChipProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        'border transition-colors cursor-pointer',
        isActive
          ? 'bg-primary/10 border-primary/30 text-foreground'
          : 'bg-muted/50 border-border/50 text-muted-foreground hover:bg-muted hover:border-border',
      )}
      onClick={onClick}
    >
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: group.color }}
      />
      <span className="truncate max-w-[120px]">{group.label}</span>
      <span className="text-muted-foreground/70">({group.chain_ids.length})</span>
    </button>
  );
}
