/**
 * InspectorToolbar — Canvas toolbar with panel toggles, configuration, and filter badge.
 */

import { useTranslation } from 'react-i18next';
import { EyeOff, Filter, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useInspectorView } from '@/context/InspectorViewContext';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { useInspectorData } from '@/context/InspectorDataContext';
import { useInspectorFilter } from '@/context/InspectorFilterContext';
import { useInspectorExport } from '@/hooks/useInspectorExport';
import { INSPECTOR_PANELS } from '@/lib/inspector/chartRegistry';
import { InspectorSelectionModeToggle } from './InspectorSelectionTools';
import { SCORE_COLUMNS } from '@/types/inspector';
import type { ScoreColumn } from '@/types/inspector';

export function InspectorToolbar() {
  const { t } = useTranslation();
  const { togglePanel, isPanelVisible } = useInspectorView();
  const { selectedCount, hasSelection, clear } = useInspectorSelection();
  const { scoreColumn, setScoreColumn, partition, setPartition, totalChains } = useInspectorData();
  const { activeFilterCount, filteredChains } = useInspectorFilter();
  const { exportAllVisiblePanelsPng, exportDataAsCsv } = useInspectorExport();

  const filteredCount = filteredChains.length;
  const hasFilters = activeFilterCount > 0;

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border/50 bg-card/50 rounded-t-lg">
      {/* Panel toggles */}
      <div className="flex items-center gap-1">
        {INSPECTOR_PANELS.map(panel => {
          const Icon = panel.icon;
          const visible = isPanelVisible(panel.id);
          return (
            <Tooltip key={panel.id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-7 w-7', !visible && 'opacity-40')}
                  onClick={() => togglePanel(panel.id)}
                >
                  {visible
                    ? <Icon className="h-3.5 w-3.5" />
                    : <EyeOff className="h-3.5 w-3.5" />
                  }
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{panel.name}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="w-px h-5 bg-border/50" />

      {/* Selection mode toggle */}
      <InspectorSelectionModeToggle />

      <div className="w-px h-5 bg-border/50" />

      {/* Score column selector */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t('inspector.toolbar.scoreColumn', 'Score')}:</span>
        <Select value={scoreColumn} onValueChange={(val) => setScoreColumn(val as ScoreColumn)}>
          <SelectTrigger className="h-7 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCORE_COLUMNS.map(col => (
              <SelectItem key={col.value} value={col.value}>{col.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Partition selector */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t('inspector.toolbar.partition', 'Partition')}:</span>
        <Select value={partition} onValueChange={setPartition}>
          <SelectTrigger className="h-7 w-[80px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="val">Val</SelectItem>
            <SelectItem value="test">Test</SelectItem>
            <SelectItem value="train">Train</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="w-px h-5 bg-border/50" />

      {/* Export dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
            <Download className="w-3.5 h-3.5" />
            {t('inspector.toolbar.export', 'Export')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={exportAllVisiblePanelsPng}>
            {t('inspector.toolbar.exportPng', 'Export panels as PNG')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportDataAsCsv}>
            {t('inspector.toolbar.exportCsv', 'Export data as CSV')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Filter badge */}
      {hasFilters && (
        <div className="flex items-center gap-1.5">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
          </Badge>
        </div>
      )}

      {/* Chain count */}
      {totalChains > 0 && (
        <span className="text-xs text-muted-foreground">
          {hasFilters ? `${filteredCount} / ${totalChains}` : `${totalChains}`} chains
        </span>
      )}

      {/* Selection badge */}
      {hasSelection && (
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="text-xs px-2 py-0.5">
            {selectedCount} selected
          </Badge>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clear}>
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
