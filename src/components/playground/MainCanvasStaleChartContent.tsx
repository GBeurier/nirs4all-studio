import { memo, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface MainCanvasStaleChartContentProps {
  stale: boolean;
  children: ReactNode;
}

export const MainCanvasStaleChartContent = memo(function MainCanvasStaleChartContent({
  stale,
  children,
}: MainCanvasStaleChartContentProps) {
  return (
    <div className={cn('h-full', stale && 'opacity-70 transition-opacity')}>
      {children}
    </div>
  );
});
