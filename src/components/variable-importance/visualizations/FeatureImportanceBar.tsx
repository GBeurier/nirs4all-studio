import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import {
  buildShapFeatureImportanceCsv,
  buildShapFeatureImportanceRows,
  getShapFeatureImportanceFill,
} from '@/lib/shapFeatureImportanceData';
import type { ShapResultsResponse, BinnedImportanceData } from '@/types/shap';

interface FeatureImportanceBarProps {
  results: ShapResultsResponse;
  binnedData?: BinnedImportanceData;
}

export function FeatureImportanceBar({ results, binnedData }: FeatureImportanceBarProps) {
  // Use rebinned data if available, otherwise from results
  const activeBinned = binnedData || results.binned_importance;

  const chartData = useMemo(() => {
    return buildShapFeatureImportanceRows(activeBinned);
  }, [activeBinned]);

  // Export to CSV
  const handleExport = () => {
    const csvContent = buildShapFeatureImportanceCsv(activeBinned);

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shap_importance_${results.job_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Bar chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 100, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 'auto']}
              tickFormatter={(value) => value.toFixed(3)}
              label={{
                value: 'Mean |SHAP| (Importance)',
                position: 'bottom',
                offset: 0,
                className: 'fill-muted-foreground text-xs',
              }}
              className="text-xs"
            />
            <YAxis
              type="category"
              dataKey="label"
              width={90}
              tick={{ fontSize: 11 }}
              className="text-xs"
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const data = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
                    <p className="font-medium">#{data.rank}: {data.label} cm⁻¹</p>
                    <p>Importance: {data.importance.toFixed(4)}</p>
                    <p className="text-muted-foreground">
                      Center: {data.center.toFixed(1)} cm⁻¹
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={getShapFeatureImportanceFill(entry.normalized)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table with export button */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Top Regions by Importance</h4>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
        <div className="border rounded-lg max-h-[200px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Rank</TableHead>
                <TableHead>Wavelength Range</TableHead>
                <TableHead className="text-right">Importance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chartData.slice(0, 10).map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="font-medium">#{row.rank}</TableCell>
                  <TableCell>{row.label} cm⁻¹</TableCell>
                  <TableCell className="text-right font-mono">
                    {row.importance.toFixed(4)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
