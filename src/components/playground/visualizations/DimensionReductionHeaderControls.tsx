import { Orbit } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  DimensionOption,
  DimensionReductionMethod,
} from '@/lib/playground/dimensionReductionData';
import type { ScatterRendererType } from './scatter';
import {
  DimensionReductionRendererControls,
} from './DimensionReductionRendererControls';
import {
  type DimensionReductionColorMode,
  type DimensionReductionPointSize,
  DimensionReductionSettingsMenu,
} from './DimensionReductionSettingsMenu';
import { DimensionReductionToolbarActions } from './DimensionReductionToolbarActions';

type DimensionReductionViewMode = '2d' | '3d';

interface DimensionReductionHeaderControlsProps {
  method: DimensionReductionMethod;
  viewMode: DimensionReductionViewMode;
  xAxis: string;
  yAxis: string;
  zAxis: string;
  nComponents: number;
  dimensionOptions: DimensionOption[];
  hasPCA: boolean;
  rendererType: ScatterRendererType;
  pointSize: DimensionReductionPointSize;
  showGrid: boolean;
  preserveAspectRatio: boolean;
  colorMode: DimensionReductionColorMode;
  metadataKey?: string;
  showEqualAxisScale: boolean;
  showLegacyColorOptions: boolean;
  hasFolds: boolean;
  metadataKeys: string[];
  enableHover: boolean;
  onMethodChange: (method: DimensionReductionMethod) => void;
  onXAxisChange: (axis: string) => void;
  onYAxisChange: (axis: string) => void;
  onZAxisChange: (axis: string) => void;
  onRendererTypeChange: (rendererType: ScatterRendererType) => void;
  onPointSizeChange: (pointSize: DimensionReductionPointSize) => void;
  onShowGridChange: (checked: boolean) => void;
  onPreserveAspectRatioChange: (checked: boolean) => void;
  onColorModeChange: (colorMode: DimensionReductionColorMode) => void;
  onMetadataKeyChange: (metadataKey: string) => void;
  onToggleViewMode: () => void;
  onToggleHover: () => void;
  onExport: () => void;
}

export function DimensionReductionHeaderControls({
  method,
  viewMode,
  xAxis,
  yAxis,
  zAxis,
  nComponents,
  dimensionOptions,
  hasPCA,
  rendererType,
  pointSize,
  showGrid,
  preserveAspectRatio,
  colorMode,
  metadataKey,
  showEqualAxisScale,
  showLegacyColorOptions,
  hasFolds,
  metadataKeys,
  enableHover,
  onMethodChange,
  onXAxisChange,
  onYAxisChange,
  onZAxisChange,
  onRendererTypeChange,
  onPointSizeChange,
  onShowGridChange,
  onPreserveAspectRatioChange,
  onColorModeChange,
  onMetadataKeyChange,
  onToggleViewMode,
  onToggleHover,
  onExport,
}: DimensionReductionHeaderControlsProps) {
  return (
    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Orbit className="w-4 h-4 text-primary" />
        {method.toUpperCase()}
        {viewMode === '3d' && (
          <Badge variant="outline" className="text-[10px] h-4 px-1">3D</Badge>
        )}
      </h3>

      <div className="flex items-center gap-1.5">
        <Select
          value={method}
          onValueChange={(value) => onMethodChange(value as DimensionReductionMethod)}
        >
          <SelectTrigger className="h-7 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pca" disabled={!hasPCA}>PCA</SelectItem>
            <SelectItem value="umap" disabled={viewMode === '3d'}>UMAP</SelectItem>
          </SelectContent>
        </Select>

        {nComponents >= 2 && (
          <>
            <DimensionReductionAxisSelect value={xAxis} options={dimensionOptions} onChange={onXAxisChange} />
            <span className="text-xs text-muted-foreground">vs</span>
            <DimensionReductionAxisSelect value={yAxis} options={dimensionOptions} onChange={onYAxisChange} />

            {viewMode === '3d' && nComponents >= 3 && (
              <>
                <span className="text-xs text-muted-foreground">vs</span>
                <DimensionReductionAxisSelect value={zAxis} options={dimensionOptions} onChange={onZAxisChange} />
              </>
            )}
          </>
        )}

        <DimensionReductionRendererControls
          rendererType={rendererType}
          onRendererTypeChange={onRendererTypeChange}
        />

        <DimensionReductionSettingsMenu
          pointSize={pointSize}
          showGrid={showGrid}
          preserveAspectRatio={preserveAspectRatio}
          colorMode={colorMode}
          metadataKey={metadataKey}
          showEqualAxisScale={showEqualAxisScale}
          showLegacyColorOptions={showLegacyColorOptions}
          hasFolds={hasFolds}
          metadataKeys={metadataKeys}
          onPointSizeChange={onPointSizeChange}
          onShowGridChange={onShowGridChange}
          onPreserveAspectRatioChange={onPreserveAspectRatioChange}
          onColorModeChange={onColorModeChange}
          onMetadataKeyChange={onMetadataKeyChange}
        />

        <DimensionReductionToolbarActions
          canToggle3d={nComponents >= 3}
          is3d={viewMode === '3d'}
          enableHover={enableHover}
          onToggleViewMode={onToggleViewMode}
          onToggleHover={onToggleHover}
          onExport={onExport}
        />
      </div>
    </div>
  );
}

interface DimensionReductionAxisSelectProps {
  value: string;
  options: DimensionOption[];
  onChange: (axis: string) => void;
}

function DimensionReductionAxisSelect({
  value,
  options,
  onChange,
}: DimensionReductionAxisSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-16 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
