import { Fragment } from 'react';
import { ReferenceArea } from 'recharts';

import type {
  SpectraDifferenceRegion,
  SpectraRangeBounds,
  SpectraRectBounds,
} from '@/lib/playground/spectraChartData';

export interface SpectraReferenceAreasProps {
  highDifferenceRegions: SpectraDifferenceRegion[];
  rangeSelectionBounds: SpectraRangeBounds | null;
  rectSelectionBounds: SpectraRectBounds | null;
}

export function SpectraReferenceAreas({
  highDifferenceRegions,
  rangeSelectionBounds,
  rectSelectionBounds,
}: SpectraReferenceAreasProps) {
  return (
    <Fragment>
      {highDifferenceRegions.map((region, index) => (
        <ReferenceArea
          key={`high-diff-${index}`}
          x1={region.start}
          x2={region.end}
          strokeOpacity={0}
          fill="hsl(30, 100%, 50%)"
          fillOpacity={0.12}
        />
      ))}

      {rangeSelectionBounds && (
        <ReferenceArea
          x1={rangeSelectionBounds.min}
          x2={rangeSelectionBounds.max}
          strokeOpacity={0.3}
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.15}
        />
      )}

      {rectSelectionBounds && (
        <ReferenceArea
          x1={rectSelectionBounds.x1}
          x2={rectSelectionBounds.x2}
          y1={rectSelectionBounds.y1}
          y2={rectSelectionBounds.y2}
          strokeOpacity={0.5}
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.2}
          strokeDasharray="4 2"
        />
      )}
    </Fragment>
  );
}
