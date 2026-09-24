/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { PCAResult } from '@/types/playground';
import { useDimensionReductionChartData } from '../useDimensionReductionChartData';
import { DimensionReductionHeaderControls } from '../DimensionReductionHeaderControls';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dominant: PCAResult = {
  coordinates: [[100, 0.1, 0.01], [-100, 0.2, -0.02], [0, -0.3, 0.01]],
  explained_variance_ratio: [0.9999, 0.00009, 0.00001],
  explained_variance: [10000, 0.9, 0.1], n_components: 3,
};
const noop = vi.fn();
function Harness({ pca, initialAxis = 'dim1' }: { pca: PCAResult; initialAxis?: string }) {
  const [xAxis, setXAxis] = useState(initialAxis);
  const derived = useDimensionReductionChartData({
    config: { method: 'pca', xAxis, yAxis: 'dim2', zAxis: 'dim3' },
    pca, selectedSamples: new Set(), pinnedSamples: new Set(), referenceLabel: 'Reference',
  });
  return <>
    <DimensionReductionHeaderControls
      method="pca" viewMode="2d" {...derived.activeAxes}
      nComponents={derived.nComponents} dimensionOptions={derived.dimensionOptions}
      hasPCA={derived.hasPCA} rendererType="recharts" pointSize="medium"
      showGrid preserveAspectRatio={false} colorMode="target" showEqualAxisScale={false}
      showLegacyColorOptions={false} hasFolds={false} metadataKeys={[]} enableHover
      onXAxisChange={setXAxis} onYAxisChange={noop} onZAxisChange={noop}
      onMethodChange={noop} onRendererTypeChange={noop} onPointSizeChange={noop}
      onShowGridChange={noop} onPreserveAspectRatioChange={noop} onColorModeChange={noop}
      onMetadataKeyChange={noop} onToggleViewMode={noop} onToggleHover={noop} onExport={noop}
    />
    <output>{JSON.stringify({ points: derived.chartData, labels: derived.axisLabels, options: derived.dimensionOptions })}</output>
  </>;
}

describe('PCA exploration', () => {
  it('keeps all computed axes selectable when PC1 explains more than 99.9%', async () => {
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Harness pca={dominant} />));
      expect(container.querySelector('[aria-label="X axis"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Y axis"]')).not.toBeNull();
      const output = JSON.parse(container.querySelector('output')!.textContent!);
      expect(output.options.map((option: { label: string }) => option.label)).toEqual(['PC1', 'PC2', 'PC3']);
      expect(output.points.map((point: { y: number }) => point.y)).toEqual([0.1, 0.2, -0.3]);
      expect(output.labels.y).toContain('PC2');
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it('recovers from an unavailable selected axis after the input shrinks to two dimensions', async () => {
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Harness pca={dominant} initialAxis="dim3" />));
      const reduced = { ...dominant, n_components: 2, coordinates: dominant.coordinates.map(row => row.slice(0, 2)) };
      await act(async () => root.render(<Harness pca={reduced} initialAxis="dim3" />));
      const output = JSON.parse(container.querySelector('output')!.textContent!);
      expect(output.points).toHaveLength(3);
      expect(output.points.map((point: { x: number }) => point.x)).toEqual([100, -100, 0]);
      expect(output.labels.x).toContain('PC1');
      expect(output.options).toHaveLength(2);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
