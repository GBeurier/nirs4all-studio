import type {
  MouseEvent,
  ReactNode,
  RefObject,
} from 'react';

import type {
  ColorContext,
  GlobalColorConfig,
} from '@/lib/playground/colorConfig';
import type {
  DimensionOption,
  DimensionReductionDataPoint,
  DimensionReductionMethod,
  DimensionReductionWebgl2DProps,
  DimensionReductionWebgl3DProps,
} from '@/lib/playground/dimensionReductionData';
import type { SelectionToolType } from '@/context/useSelection';
import type { SelectionResult } from '../selectionGeometry';
import { DimensionReductionFooter } from './DimensionReductionFooter';
import { DimensionReductionHeaderControls } from './DimensionReductionHeaderControls';
import { DimensionReductionRendererContainer } from './DimensionReductionRendererContainer';
import { DimensionReductionRendererSurface } from './DimensionReductionRendererSurface';
import type {
  DimensionReductionColorMode,
  DimensionReductionPointSize,
} from './DimensionReductionSettingsMenu';
import type {
  Scatter3DHandle,
  ScatterRendererType,
} from './scatter';

type DimensionReductionViewMode = '2d' | '3d';

interface DimensionReductionAxisLabels {
  x: string;
  y: string;
  z: string;
}

interface DimensionReductionChartFrameProps {
  chartRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  scatter3DRef: RefObject<Scatter3DHandle | null>;
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
  pointBaseSize: number;
  showGrid: boolean;
  preserveAspectRatio: boolean;
  colorMode: DimensionReductionColorMode;
  metadataKey?: string;
  showEqualAxisScale: boolean;
  showLegacyColorOptions: boolean;
  hasFolds: boolean;
  metadataKeys: string[];
  enableHover: boolean;
  selectionTool: SelectionToolType;
  selectionEnabled: boolean;
  useSelectionContext: boolean;
  webgl2DProps: DimensionReductionWebgl2DProps;
  webgl3DProps: DimensionReductionWebgl3DProps;
  recharts2DView: ReactNode;
  recharts3DView: ReactNode;
  axisLabels: DimensionReductionAxisLabels;
  hoveredPoint: DimensionReductionDataPoint | null;
  mousePosition: { x: number; y: number } | null;
  containerWidth?: number;
  compact: boolean;
  showVarianceSummary: boolean;
  selectedCount: number;
  globalColorConfig?: GlobalColorConfig;
  colorContext?: ColorContext;
  hasReferenceData: boolean;
  referenceLabel: string;
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
  onContainerMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onContainerMouseLeave: () => void;
  onRechartsSelectionComplete: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  onWebglSelectionComplete: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  on3DSelectionComplete: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  onBackgroundClick: () => void;
  onRechartsBackgroundClick: (event: MouseEvent<HTMLDivElement>) => void;
}

export function DimensionReductionChartFrame({
  chartRef,
  containerRef,
  scatter3DRef,
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
  pointBaseSize,
  showGrid,
  preserveAspectRatio,
  colorMode,
  metadataKey,
  showEqualAxisScale,
  showLegacyColorOptions,
  hasFolds,
  metadataKeys,
  enableHover,
  selectionTool,
  selectionEnabled,
  useSelectionContext,
  webgl2DProps,
  webgl3DProps,
  recharts2DView,
  recharts3DView,
  axisLabels,
  hoveredPoint,
  mousePosition,
  containerWidth,
  compact,
  showVarianceSummary,
  selectedCount,
  globalColorConfig,
  colorContext,
  hasReferenceData,
  referenceLabel,
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
  onContainerMouseMove,
  onContainerMouseLeave,
  onRechartsSelectionComplete,
  onWebglSelectionComplete,
  on3DSelectionComplete,
  onBackgroundClick,
  onRechartsBackgroundClick,
}: DimensionReductionChartFrameProps) {
  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      <DimensionReductionHeaderControls
        method={method}
        viewMode={viewMode}
        xAxis={xAxis}
        yAxis={yAxis}
        zAxis={zAxis}
        nComponents={nComponents}
        dimensionOptions={dimensionOptions}
        hasPCA={hasPCA}
        rendererType={rendererType}
        pointSize={pointSize}
        showGrid={showGrid}
        preserveAspectRatio={preserveAspectRatio}
        colorMode={colorMode}
        metadataKey={metadataKey}
        showEqualAxisScale={showEqualAxisScale}
        showLegacyColorOptions={showLegacyColorOptions}
        hasFolds={hasFolds}
        metadataKeys={metadataKeys}
        enableHover={enableHover}
        onMethodChange={onMethodChange}
        onXAxisChange={onXAxisChange}
        onYAxisChange={onYAxisChange}
        onZAxisChange={onZAxisChange}
        onRendererTypeChange={onRendererTypeChange}
        onPointSizeChange={onPointSizeChange}
        onShowGridChange={onShowGridChange}
        onPreserveAspectRatioChange={onPreserveAspectRatioChange}
        onColorModeChange={onColorModeChange}
        onMetadataKeyChange={onMetadataKeyChange}
        onToggleViewMode={onToggleViewMode}
        onToggleHover={onToggleHover}
        onExport={onExport}
      />

      <DimensionReductionRendererContainer
        containerRef={containerRef}
        rendererType={rendererType}
        onMouseMove={onContainerMouseMove}
        onMouseLeave={onContainerMouseLeave}
      >
        <DimensionReductionRendererSurface
          viewMode={viewMode}
          rendererType={rendererType}
          selectionTool={selectionTool}
          selectionEnabled={selectionEnabled}
          useSelectionContext={useSelectionContext}
          webgl2DProps={webgl2DProps}
          webgl3DProps={webgl3DProps}
          scatter3DRef={scatter3DRef}
          recharts2DView={recharts2DView}
          recharts3DView={recharts3DView}
          pointSize={pointBaseSize}
          showGrid={showGrid}
          preserveAspectRatio={preserveAspectRatio}
          axisLabels={axisLabels}
          enableHover={enableHover}
          hoveredPoint={hoveredPoint}
          mousePosition={mousePosition}
          containerWidth={containerWidth}
          onRechartsSelectionComplete={onRechartsSelectionComplete}
          onWebglSelectionComplete={onWebglSelectionComplete}
          on3DSelectionComplete={on3DSelectionComplete}
          onBackgroundClick={onBackgroundClick}
          onRechartsBackgroundClick={onRechartsBackgroundClick}
        />
      </DimensionReductionRendererContainer>

      <DimensionReductionFooter
        compact={compact}
        showVarianceSummary={showVarianceSummary}
        xAxisLabel={axisLabels.x}
        yAxisLabel={axisLabels.y}
        selectedCount={selectedCount}
        globalColorConfig={globalColorConfig}
        colorContext={colorContext}
        hasReferenceData={hasReferenceData}
        referenceLabel={referenceLabel}
      />
    </div>
  );
}
