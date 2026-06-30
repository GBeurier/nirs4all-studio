import { Zap } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface WebglIndicatorBadgeProps {
  position?: 'top-left' | 'top-right';
  label?: string;
  className?: string;
}

export function WebglIndicatorBadge({
  position = 'top-right',
  label = 'WebGL',
  className,
}: WebglIndicatorBadgeProps) {
  return (
    <div className={cn(
      'absolute top-2 z-10 flex items-center gap-1 px-2 py-0.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded text-[10px] font-medium',
      position === 'top-left' ? 'left-2' : 'right-2',
      className
    )}>
      <Zap className="w-3 h-3" />
      {label}
    </div>
  );
}
