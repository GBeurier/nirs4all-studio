import { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { PCACoordinate } from '@/types/transfer';

interface TransferPCAScatterProps {
  coordinates: PCACoordinate[];
  datasets: string[];
}

// Contrastive color palette
const DATASET_COLORS = [
  '#e41a1c', // Red
  '#377eb8', // Blue
  '#4daf4a', // Green
  '#984ea3', // Purple
  '#ff7f00', // Orange
  '#ffff33', // Yellow
  '#a65628', // Brown
  '#f781bf', // Pink
  '#999999', // Gray
  '#66c2a5', // Teal
];

export function TransferPCAScatter({ coordinates, datasets }: TransferPCAScatterProps) {
  // Group coordinates by dataset
  const dataByDataset = useMemo(() => {
    const grouped: Record<string, { x: number; y: number; index: number }[]> = {};
    for (const coord of coordinates) {
      if (!grouped[coord.dataset]) {
        grouped[coord.dataset] = [];
      }
      grouped[coord.dataset].push({
        x: coord.x,
        y: coord.y,
        index: coord.sample_index,
      });
    }
    return grouped;
  }, [coordinates]);

  // Get color for dataset
  const getDatasetColor = (dataset: string): string => {
    const index = datasets.indexOf(dataset);
    return DATASET_COLORS[index % DATASET_COLORS.length];
  };

  if (coordinates.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No PCA coordinates available
      </div>
    );
  }

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: { payload: { x: number; y: number; index: number }; name: string }[];
  }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const datasetName = payload[0].name;
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
          <p className="font-medium">{datasetName}</p>
          <p className="text-muted-foreground">Sample: {data.index}</p>
          <p className="text-muted-foreground">PC1: {data.x.toFixed(3)}</p>
          <p className="text-muted-foreground">PC2: {data.y.toFixed(3)}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            type="number"
            dataKey="x"
            name="PC1"
            tick={{ fontSize: 11 }}
            label={{ value: 'PC1', position: 'bottom', offset: 0, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="PC2"
            tick={{ fontSize: 11 }}
            label={{ value: 'PC2', angle: -90, position: 'left', offset: 0, fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="top"
            height={36}
            wrapperStyle={{ fontSize: 11 }}
          />
          {Object.entries(dataByDataset).map(([dataset, data]) => (
            <Scatter
              key={dataset}
              name={dataset}
              data={data}
              fill={getDatasetColor(dataset)}
              fillOpacity={0.6}
              stroke={getDatasetColor(dataset)}
              strokeWidth={1}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
