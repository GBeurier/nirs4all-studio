import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '@/lib/utils';

export interface RibbonGroupProps {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}

export const RibbonGroup = memo(function RibbonGroup({ label, icon, children, className }: RibbonGroupProps) {
  return (
    <div className={cn('flex items-center gap-2 pl-3 pr-4 border-r-2 border-border/60 last:border-r-0 last:pr-3', className)}>
      <div className="flex items-center gap-1 text-[9px] text-muted-foreground font-medium uppercase tracking-wider shrink-0 select-none">
        {icon}
        <span className="border-b border-muted-foreground/30">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        {children}
      </div>
    </div>
  );
});
