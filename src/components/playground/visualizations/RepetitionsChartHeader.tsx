import {
  ArrowUpDown,
  Download,
  Monitor,
  MousePointer2,
  Repeat,
  Settings2,
  Zap,
  ZoomIn,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type {
  RepetitionsSortOption,
  RepetitionsZoomInfo,
} from '@/lib/playground/repetitionsChartData';
import { cn } from '@/lib/utils';
import { DiffModeControls } from './DiffModeControls';

type RepetitionsRendererType = 'recharts' | 'webgl';

const SORT_OPTIONS: { value: RepetitionsSortOption; label: string; description: string }[] = [
  { value: 'index', label: 'Original Index', description: 'Original sample order' },
  { value: 'name', label: 'Name', description: 'Alphabetical by bio sample' },
  { value: 'distance', label: 'Distance ↑', description: 'Lowest distance first' },
  { value: 'distance_desc', label: 'Distance ↓', description: 'Highest distance first' },
  { value: 'variance', label: 'Variance ↑', description: 'Lowest within-group variance first' },
  { value: 'variance_desc', label: 'Variance ↓', description: 'Highest within-group variance first' },
  { value: 'color', label: 'Color Value', description: 'By color/target value' },
  { value: 'metadata_column', label: 'Metadata Column', description: 'Group samples sharing the same metadata value on the same X' },
];

export interface RepetitionsChartHeaderProps {
  hasRepetitions: boolean;
  bioSampleCount: number;
  groupCount: number;
  compact?: boolean;
  isBusy: boolean;
  configResult?: UseSpectraChartConfigResult;
  hasReferenceDataset?: boolean;
  showGrid: boolean;
  onGridToggle: () => void;
  sortBy: RepetitionsSortOption;
  onSortByChange: (sortBy: RepetitionsSortOption) => void;
  availableMetadataColumns: string[];
  metadataSortColumn: string | null;
  onMetadataSortColumnChange: (column: string | null) => void;
  rendererType: RepetitionsRendererType;
  onRendererTypeChange: (rendererType: RepetitionsRendererType) => void;
  enableHover: boolean;
  onEnableHoverChange: (enabled: boolean) => void;
  zoomInfo: RepetitionsZoomInfo;
  onConfigureRepetitions?: () => void;
  onExport: () => void;
}

export function RepetitionsChartHeader({
  hasRepetitions,
  bioSampleCount,
  groupCount,
  compact = false,
  isBusy,
  configResult,
  hasReferenceDataset = false,
  showGrid,
  onGridToggle,
  sortBy,
  onSortByChange,
  availableMetadataColumns,
  metadataSortColumn,
  onMetadataSortColumnChange,
  rendererType,
  onRendererTypeChange,
  enableHover,
  onEnableHoverChange,
  zoomInfo,
  onConfigureRepetitions,
  onExport,
}: RepetitionsChartHeaderProps) {
  const selectedSortLabel = SORT_OPTIONS.find(option => option.value === sortBy)?.label;

  return (
    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Repeat className="w-4 h-4 text-primary" />
        Repetitions
        <Badge variant="secondary" className="text-[10px] font-normal">
          {hasRepetitions ? `${bioSampleCount} bio samples` : `${groupCount} groups`}
        </Badge>
        {!hasRepetitions && onConfigureRepetitions && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={onConfigureRepetitions}
          >
            <Settings2 className="w-3 h-3 mr-1" />
            Configure
          </Button>
        )}
        {isBusy && (
          <span className="text-[10px] text-muted-foreground animate-pulse">Computing...</span>
        )}
      </h3>

      <div className="flex items-center gap-1.5">
        {configResult && (
          <>
            <DiffModeControls
              configResult={configResult}
              compact={compact}
              hasReferenceDataset={hasReferenceDataset}
              hasRepetitions={true}
              showGrid={showGrid}
              onGridToggle={onGridToggle}
            />
            <Separator orientation="vertical" className="h-4 mx-0.5" />
          </>
        )}

        <DropdownMenu>
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={sortBy !== 'index' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                  >
                    <ArrowUpDown className="w-3 h-3" />
                    {!compact && selectedSortLabel}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Sort samples by</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>
          <DropdownMenuContent side="bottom" align="start" className="w-48">
            <DropdownMenuLabel className="text-[10px] text-muted-foreground">
              Sort Samples By
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={sortBy}
              onValueChange={(value) => onSortByChange(value as RepetitionsSortOption)}
            >
              {SORT_OPTIONS.map(option => {
                if (option.value === 'metadata_column' && availableMetadataColumns.length === 0) return null;
                return (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="text-xs"
                  >
                    <div className="flex flex-col">
                      <span>{option.label}</span>
                      <span className="text-[10px] text-muted-foreground">{option.description}</span>
                    </div>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {sortBy === 'metadata_column' && availableMetadataColumns.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="h-7 px-2 text-xs gap-1">
                {metadataSortColumn ?? 'Column…'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="start" className="w-48 max-h-72 overflow-y-auto">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Group / sort by column
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={metadataSortColumn ?? ''}
                onValueChange={(value) => onMetadataSortColumnChange(value || null)}
              >
                {availableMetadataColumns.map(column => (
                  <DropdownMenuRadioItem key={column} value={column} className="text-xs">
                    {column}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <TooltipProvider delayDuration={200}>
          <div className="flex items-center border rounded-md">
            <TooltipUI>
              <TooltipTrigger asChild>
                <Button
                  variant={rendererType === 'recharts' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 w-7 p-0 rounded-r-none border-r"
                  onClick={() => onRendererTypeChange('recharts')}
                >
                  <Monitor className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">SVG renderer (Recharts)</p>
              </TooltipContent>
            </TooltipUI>

            <TooltipUI>
              <TooltipTrigger asChild>
                <Button
                  variant={rendererType === 'webgl' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 w-7 p-0 rounded-l-none border-l"
                  onClick={() => onRendererTypeChange('webgl')}
                >
                  <Zap className={`w-3.5 h-3.5 ${rendererType === 'webgl' ? 'text-yellow-500' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">WebGL (GPU accelerated)</p>
              </TooltipContent>
            </TooltipUI>
          </div>
        </TooltipProvider>

        <TooltipProvider delayDuration={200}>
          <TooltipUI>
            <TooltipTrigger asChild>
              <Button
                variant={enableHover ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => onEnableHoverChange(!enableHover)}
              >
                <MousePointer2 className={cn('w-3.5 h-3.5', enableHover && 'text-primary')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{enableHover ? 'Hover enabled' : 'Hover disabled'}</p>
            </TooltipContent>
          </TooltipUI>
        </TooltipProvider>

        {zoomInfo.level < 100 && (
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="h-6 text-[10px] gap-1 cursor-default">
                  <ZoomIn className="w-3 h-3" />
                  {zoomInfo.visible}/{zoomInfo.total}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Showing {zoomInfo.visible} of {zoomInfo.total} samples ({zoomInfo.level}%)</p>
                <p className="text-[10px] text-muted-foreground">Double-click to reset zoom</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>
        )}

        <Separator orientation="vertical" className="h-4 mx-0.5" />

        {onConfigureRepetitions && (
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={onConfigureRepetitions}
                >
                  <Settings2 className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Configure repetition detection</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>
        )}

        <TooltipProvider delayDuration={200}>
          <TooltipUI>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onExport}>
                <Download className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Export data</p>
            </TooltipContent>
          </TooltipUI>
        </TooltipProvider>
      </div>
    </div>
  );
}
