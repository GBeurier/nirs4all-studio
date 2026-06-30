import type {
  MouseEvent,
  ReactNode,
  RefObject,
} from 'react';

import { cn } from '@/lib/utils';
import type { ScatterRendererType } from './scatter';

interface DimensionReductionRendererContainerProps {
  containerRef: RefObject<HTMLDivElement | null>;
  rendererType: ScatterRendererType;
  children: ReactNode;
  onMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
}

export function DimensionReductionRendererContainer({
  containerRef,
  rendererType,
  children,
  onMouseMove,
  onMouseLeave,
}: DimensionReductionRendererContainerProps) {
  const isRechartsRenderer = rendererType === 'recharts';

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex-1 min-h-[200px] max-h-full relative',
        isRechartsRenderer && 'aspect-square',
      )}
      onMouseMove={isRechartsRenderer ? undefined : onMouseMove}
      onMouseLeave={isRechartsRenderer ? undefined : onMouseLeave}
    >
      {children}
    </div>
  );
}
