import { useMemo } from 'react';
import type { DatasetPairDistance, TransferMetricType } from '@/types/transfer';

interface DistanceMatrixHeatmapProps {
  distances: DatasetPairDistance[];
  datasets: string[];
  metric: TransferMetricType;
}

export function DistanceMatrixHeatmap({ distances, datasets, metric }: DistanceMatrixHeatmapProps) {
  // Build distance matrix
  const matrix = useMemo(() => {
    const n = datasets.length;
    const mat: (number | null)[][] = Array(n)
      .fill(null)
      .map(() => Array(n).fill(null));

    for (const dist of distances) {
      const i = datasets.indexOf(dist.dataset_1);
      const j = datasets.indexOf(dist.dataset_2);
      if (i >= 0 && j >= 0) {
        const value = metric === 'centroid' ? dist.centroid_dist_pp : dist.spread_dist_pp;
        mat[i][j] = value;
        mat[j][i] = value; // Symmetric
      }
    }

    return mat;
  }, [distances, datasets, metric]);

  // Find min/max for color scaling
  const { minVal, maxVal } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const row of matrix) {
      for (const val of row) {
        if (val !== null && val !== 0) {
          min = Math.min(min, val);
          max = Math.max(max, val);
        }
      }
    }
    return { minVal: min === Infinity ? 0 : min, maxVal: max === -Infinity ? 1 : max };
  }, [matrix]);

  // Color function (YlOrRd colormap)
  const getColor = (value: number | null): string => {
    if (value === null || value === 0) return 'rgb(248, 249, 250)';
    const t = (value - minVal) / (maxVal - minVal + 0.0001);
    // YlOrRd: yellow -> orange -> red
    const r = Math.round(255);
    const g = Math.round(255 * (1 - t * 0.7));
    const b = Math.round(255 * (1 - t * 0.9));
    return `rgb(${r}, ${g}, ${b})`;
  };

  const getTextColor = (value: number | null): string => {
    if (value === null) return 'black';
    const t = (value - minVal) / (maxVal - minVal + 0.0001);
    return t > 0.7 ? 'white' : 'black';
  };

  if (datasets.length === 0 || distances.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No distance data available
      </div>
    );
  }

  const cellSize = Math.min(60, 400 / datasets.length);

  return (
    <div className="overflow-x-auto">
      <div
        className="inline-grid gap-0.5"
        style={{
          gridTemplateColumns: `auto repeat(${datasets.length}, ${cellSize}px)`,
        }}
      >
        {/* Header row */}
        <div className="w-24" /> {/* Empty corner */}
        {datasets.map((ds) => (
          <div
            key={`header-${ds}`}
            className="text-xs text-center font-medium truncate px-1"
            style={{ width: cellSize }}
            title={ds}
          >
            {ds.length > 8 ? ds.slice(0, 7) + '...' : ds}
          </div>
        ))}

        {/* Data rows */}
        {datasets.map((rowDs, i) => (
          <>
            <div
              key={`row-${rowDs}`}
              className="text-xs font-medium truncate flex items-center pr-2"
              style={{ width: '6rem' }}
              title={rowDs}
            >
              {rowDs.length > 12 ? rowDs.slice(0, 11) + '...' : rowDs}
            </div>
            {datasets.map((_, j) => {
              const value = matrix[i][j];
              return (
                <div
                  key={`cell-${i}-${j}`}
                  className="flex items-center justify-center text-xs font-medium rounded-sm"
                  style={{
                    width: cellSize,
                    height: cellSize,
                    backgroundColor: getColor(value),
                    color: getTextColor(value),
                  }}
                  title={value !== null ? value.toFixed(4) : 'N/A'}
                >
                  {i === j ? '-' : value !== null ? value.toFixed(2) : ''}
                </div>
              );
            })}
          </>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
        <span>Low</span>
        <div
          className="h-3 w-32 rounded"
          style={{
            background: 'linear-gradient(to right, rgb(255,255,255), rgb(255,178,102), rgb(255,77,77))',
          }}
        />
        <span>High</span>
        <span className="ml-4">
          ({metric === 'centroid' ? 'Centroid' : 'Spread'} Distance)
        </span>
      </div>
    </div>
  );
}
