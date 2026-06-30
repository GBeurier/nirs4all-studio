import type {
  RepetitionsWebglData,
} from '@/lib/playground/repetitionsChartData';
import {
  ScatterPureWebGL2D,
  type DataBounds,
} from './scatter';

interface RepetitionsWebglPlotProps {
  data: RepetitionsWebglData;
  useSelectionContext: boolean;
  clearOnBackgroundClick: boolean;
  customBounds: DataBounds;
}

export function RepetitionsWebglPlot({
  data,
  useSelectionContext,
  clearOnBackgroundClick,
  customBounds,
}: RepetitionsWebglPlotProps) {
  return (
    <div className="absolute left-10 right-0 top-0 bottom-6">
      <ScatterPureWebGL2D
        points={data.points}
        indices={data.indices}
        colors={data.colors}
        values={data.values}
        useSelectionContext={useSelectionContext}
        pointSize={6}
        showGrid={false}
        showAxes={false}
        className="h-full w-full"
        clearOnBackgroundClick={clearOnBackgroundClick}
        customBounds={customBounds}
      />
    </div>
  );
}
