import { Fragment } from 'react';
import { Area, Line } from 'recharts';

import { getCategoricalColor, type CategoricalPalette } from '@/lib/playground/colorConfig';
import type { AggregationMode } from '@/lib/playground/spectraConfig';
import { ANIMATION_CONFIG } from './chartConfig';

export interface SpectraGroupedAggregationSeriesProps {
  groupKeys: Array<string | number>;
  aggregationMode: AggregationMode;
  categoricalPalette?: CategoricalPalette;
}

export function SpectraGroupedAggregationSeries({
  groupKeys,
  aggregationMode,
  categoricalPalette = 'default',
}: SpectraGroupedAggregationSeriesProps) {
  if (aggregationMode === 'none' || groupKeys.length === 0) {
    return null;
  }

  return (
    <Fragment>
      {groupKeys.map((groupKey, groupIndex) => {
        const prefix = `grp_${groupKey}`;
        const groupColor = getCategoricalColor(groupIndex, categoricalPalette);

        return (
          <Fragment key={`group-${groupKey}`}>
            {aggregationMode === 'mean_std' && (
              <Area
                type="monotone"
                dataKey={`${prefix}_std_high`}
                stroke="none"
                fill={groupColor}
                fillOpacity={0.15}
                {...ANIMATION_CONFIG}
              />
            )}

            {aggregationMode === 'median_quantiles' && (
              <Area
                type="monotone"
                dataKey={`${prefix}_q_high`}
                stroke="none"
                fill={groupColor}
                fillOpacity={0.15}
                {...ANIMATION_CONFIG}
              />
            )}

            {aggregationMode === 'minmax' && (
              <Fragment>
                <Area
                  type="monotone"
                  dataKey={`${prefix}_max`}
                  stroke="none"
                  fill={groupColor}
                  fillOpacity={0.1}
                  {...ANIMATION_CONFIG}
                />
                <Line
                  type="monotone"
                  dataKey={`${prefix}_min`}
                  stroke={groupColor}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  dot={false}
                  activeDot={false}
                  {...ANIMATION_CONFIG}
                />
                <Line
                  type="monotone"
                  dataKey={`${prefix}_max`}
                  stroke={groupColor}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  dot={false}
                  activeDot={false}
                  {...ANIMATION_CONFIG}
                />
              </Fragment>
            )}

            <Line
              type="monotone"
              dataKey={aggregationMode === 'median_quantiles' ? `${prefix}_median` : `${prefix}_mean`}
              stroke={groupColor}
              strokeWidth={2}
              dot={false}
              activeDot={false}
              {...ANIMATION_CONFIG}
            />
          </Fragment>
        );
      })}
    </Fragment>
  );
}
