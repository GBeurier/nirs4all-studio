import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FeatureImportanceBar as FeatureImportanceView, compactNumber, signedNumber } from 'nirs4all-ui/viz';
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
import { ChartScrollRegion } from './ChartScrollRegion';
import { getShapAxisDisplay } from '@/lib/shapAxisDisplay';
import { normalizeShapBinAggregation } from '@/lib/shapBinningControlsData';
import {
  buildShapFeatureImportanceCsv,
  buildShapFeatureImportanceRows,
} from '@/lib/shapFeatureImportanceData';
import { getShapBinValueKind } from '@/lib/shapSpectralImportanceData';
import type { ShapResultsResponse, BinnedImportanceData } from '@/types/shap';

interface FeatureImportanceBarProps {
  results: ShapResultsResponse;
  binnedData?: BinnedImportanceData;
}

export function FeatureImportanceBar({ results, binnedData }: FeatureImportanceBarProps) {
  const { t } = useTranslation();
  const axis = getShapAxisDisplay(results.axis_unit, t);
  // Use rebinned data if available, otherwise from results
  const activeBinned = binnedData || results.binned_importance;
  const aggregation = normalizeShapBinAggregation(activeBinned.aggregation);
  const signed = getShapBinValueKind(aggregation) === 'signed';
  const regionLabel = t(`results.variableImportance.spectral.region.${aggregation}`);
  const formatValue = (value: number) => (signed ? signedNumber(value) : compactNumber(value));

  const rows = useMemo(() => buildShapFeatureImportanceRows(activeBinned), [activeBinned]);
  const items = useMemo(
    () => rows.map((row) => ({ label: `${row.label}${axis.suffix}`, value: row.importance })),
    [rows, axis.suffix],
  );

  // Export to CSV
  const handleExport = () => {
    const csvContent = buildShapFeatureImportanceCsv(activeBinned, results.axis_unit, t);

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
    <div className="flex flex-col gap-4">
      <ChartScrollRegion label={t('results.variableImportance.ranking.title')}>
        {(width) => (
          <FeatureImportanceView
            items={items}
            topN={rows.length}
            signed={signed}
            showRank
            xLabel={regionLabel}
            valueFormat={compactNumber}
            title={t('results.variableImportance.ranking.title')}
            width={width}
          />
        )}
      </ChartScrollRegion>
      {signed && (
        <p className="text-xs text-muted-foreground">{t('results.variableImportance.ranking.signedNote')}</p>
      )}

      {/* Table with export button */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">{t('results.variableImportance.ranking.topRegions')}</h4>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />
            {t('results.variableImportance.ranking.exportCsv')}
          </Button>
        </div>
        <div className="border rounded-lg max-h-[240px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">{t('results.variableImportance.ranking.rank')}</TableHead>
                <TableHead>{t('results.variableImportance.axis.range', { axis: axis.label })}</TableHead>
                <TableHead className="text-right">{regionLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="font-medium">#{row.rank}</TableCell>
                  <TableCell>{row.label}{axis.suffix}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatValue(row.importance)}
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
