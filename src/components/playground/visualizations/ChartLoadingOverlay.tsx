import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ChartLoadingOverlayProps {
  label: string;
  showLabel?: boolean;
  overlayClassName?: string;
  contentClassName?: string;
}

export function ChartLoadingOverlay({
  label,
  showLabel = false,
  overlayClassName,
  contentClassName,
}: ChartLoadingOverlayProps) {
  return (
    <div className={cn(
      'absolute inset-0 bg-background/80 flex items-center justify-center z-20 pointer-events-none',
      overlayClassName
    )}>
      <div className={cn('flex flex-col items-center gap-2', contentClassName)}>
        <Loader2 className="w-5 h-5 animate-spin text-primary" aria-hidden="true" />
        <span className={showLabel ? 'text-xs text-muted-foreground' : 'sr-only'}>
          {label}
        </span>
      </div>
    </div>
  );
}
