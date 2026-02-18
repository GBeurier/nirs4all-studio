/**
 * SourceSelector — Run and dataset selection for Inspector sidebar.
 */

import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useInspectorData } from '@/context/InspectorDataContext';

export function SourceSelector() {
  const { t } = useTranslation();
  const { filters, setFilters, availableRuns, availableDatasets } = useInspectorData();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Database className="w-4 h-4 text-muted-foreground" />
        <span>{t('inspector.sidebar.source', 'Source')}</span>
      </div>

      {/* Run selector */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          {t('inspector.sidebar.selectRun', 'Run')}
        </label>
        <Select
          value={filters.run_id ?? 'all'}
          onValueChange={(val) => setFilters({ ...filters, run_id: val === 'all' ? undefined : val })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="All runs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All runs</SelectItem>
            {availableRuns.map(runId => (
              <SelectItem key={runId} value={runId}>
                {runId.length > 20 ? `${runId.slice(0, 20)}...` : runId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Dataset selector */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          {t('inspector.sidebar.selectDataset', 'Dataset')}
        </label>
        <Select
          value={filters.dataset_name ?? 'all'}
          onValueChange={(val) => setFilters({ ...filters, dataset_name: val === 'all' ? undefined : val })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="All datasets" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All datasets</SelectItem>
            {availableDatasets.map(name => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
