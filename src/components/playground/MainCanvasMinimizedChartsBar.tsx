import { memo } from 'react';

import { ChartPanel } from './ChartPanel';
import type { ChartType } from '@/context/usePlaygroundView';

export interface MainCanvasMinimizedChartsBarProps {
  minimizedCharts: ChartType[];
  onRestore: (chart: ChartType) => void;
  onHide: (chart: ChartType) => void;
}

export const MainCanvasMinimizedChartsBar = memo(function MainCanvasMinimizedChartsBar({
  minimizedCharts,
  onRestore,
  onHide,
}: MainCanvasMinimizedChartsBarProps) {
  if (minimizedCharts.length === 0) {
    return null;
  }

  return (
    <div className="col-span-full flex gap-2 flex-wrap">
      {minimizedCharts.map(chart => (
        <ChartPanel
          key={chart}
          chartType={chart}
          viewState="minimized"
          isMaximized={false}
          onRestore={() => onRestore(chart)}
          onHide={() => onHide(chart)}
          className="w-auto min-w-[200px]"
        >
          <div />
        </ChartPanel>
      ))}
    </div>
  );
});
