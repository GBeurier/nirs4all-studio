/**
 * Chart loading skeleton component
 *
 * Phase 1 Refactoring: Performance Optimizations
 *
 * Provides consistent loading states for visualization charts.
 * Wrapped with React.memo for optimal performance.
 */

import { memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ChartSkeletonProps {
  type?: 'spectra' | 'pca' | 'histogram' | 'folds' | 'default';
  className?: string;
}

export const ChartSkeleton = memo(function ChartSkeleton({ type = 'default', className }: ChartSkeletonProps) {
  return (
    <div className={cn('w-full h-full min-h-[200px] flex flex-col p-4', className)}>
      {/* Title skeleton */}
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>

      {/* Chart area skeleton */}
      <div className="flex-1 relative">
        {type === 'spectra' && <SpectraChartSkeleton />}
        {type === 'pca' && <PCAChartSkeleton />}
        {type === 'histogram' && <HistogramSkeleton />}
        {type === 'folds' && <FoldsSkeleton />}
        {type === 'default' && <DefaultChartSkeleton />}
      </div>
    </div>
  );
});

function SpectraChartSkeleton() {
  return (
    <div className="w-full h-full flex flex-col">
      {/* Y-axis labels */}
      <div className="absolute left-0 top-0 h-full w-8 flex flex-col justify-between py-2">
        <Skeleton className="h-3 w-6" />
        <Skeleton className="h-3 w-6" />
        <Skeleton className="h-3 w-6" />
      </div>

      {/* Chart area with wave-like lines */}
      <div className="flex-1 ml-10 mr-2 relative">
        {[0.2, 0.4, 0.6].map((opacity, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 h-px bg-muted-foreground/20"
            style={{ top: `${30 + i * 20}%` }}
          />
        ))}

        {/* Simulated spectrum lines */}
        <svg className="w-full h-full opacity-30">
          <path
            d="M0,50 Q25,30 50,45 T100,50 T150,55 T200,45 T250,50 T300,48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-primary"
          />
        </svg>
      </div>

      {/* X-axis labels */}
      <div className="h-6 ml-10 flex justify-between mt-2">
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-8" />
      </div>
    </div>
  );
}

function PCAChartSkeleton() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      {/* Scatter dots placeholder */}
      <div className="relative w-3/4 h-3/4">
        {[...Array(12)].map((_, i) => (
          <Skeleton
            key={i}
            className="absolute w-3 h-3 rounded-full"
            style={{
              left: `${20 + Math.random() * 60}%`,
              top: `${20 + Math.random() * 60}%`,
            }}
          />
        ))}

        {/* Axes */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-muted-foreground/20" />
        <div className="absolute left-0 top-0 bottom-0 w-px bg-muted-foreground/20" />
      </div>
    </div>
  );
}

function HistogramSkeleton() {
  return (
    <div className="w-full h-full flex items-end justify-center gap-2 pb-6">
      {[40, 70, 90, 80, 60, 50, 75, 85, 65, 45].map((height, i) => (
        <Skeleton
          key={i}
          className="w-6 rounded-t"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

function FoldsSkeleton() {
  return (
    <div className="w-full h-full flex flex-col gap-2 p-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-4 w-12" />
          <div className="flex-1 flex gap-1">
            <Skeleton className="h-6 flex-[4]" />
            <Skeleton className="h-6 flex-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DefaultChartSkeleton() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="text-center space-y-3">
        <Skeleton className="h-16 w-16 rounded-lg mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
        <Skeleton className="h-3 w-24 mx-auto" />
      </div>
    </div>
  );
}

export default ChartSkeleton;
