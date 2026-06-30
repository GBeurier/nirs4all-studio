/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpectraWebGLScene } from '../SpectraWebGLScene';
import type { SpectraWebGLSceneProps } from '../SpectraWebGLScene';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../SpectraWebGLCamera', () => ({
  SpectraWebGLCamera: () => <div data-testid="camera" />,
}));

vi.mock('../SpectraWebGLXZoomController', () => ({
  SpectraWebGLXZoomController: () => <div data-testid="x-zoom" />,
}));

vi.mock('../SpectraWebGLInteractionController', () => ({
  SpectraWebGLInteractionController: () => <div data-testid="interaction" />,
}));

vi.mock('../SpectraWebGLAxes', () => ({
  SpectraWebGLAxes: () => <div data-testid="axes" />,
}));

vi.mock('../SpectraWebGLAggregatedAreas', () => ({
  SpectraWebGLAggregatedArea: () => <div data-testid="aggregated-area" />,
  SpectraWebGLGroupedAreas: () => <div data-testid="grouped-areas" />,
}));

vi.mock('../SpectraWebGLLineLayers', () => ({
  SpectraLines: () => <div data-testid="lines" />,
}));

let mountedRoots: Root[] = [];
let mountedContainers: HTMLDivElement[] = [];

async function render(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mountedContainers.push(container);

  const root = createRoot(container);
  mountedRoots.push(root);

  await act(async () => {
    root.render(element);
  });

  return container;
}

function baseProps(): SpectraWebGLSceneProps {
  return {
    lines: [],
    xRange: [1000, 1100],
    yRange: [0, 1],
    xViewRange: [1000, 1100],
    onXViewRangeChange: vi.fn(),
    qualityConfig: {
      maxPointsPerSpectrum: 1000,
      normalLineWidth: 1,
      selectedLineWidth: 2,
      normalOpacity: 1,
      antialias: true,
      maxDpr: 2,
    },
    showGrid: true,
    onHover: vi.fn(),
    onClick: vi.fn(),
  };
}

function areaStats() {
  return {
    wavelengths: [1000, 1100],
    mean: [0.5, 0.6],
    median: [0.5, 0.6],
    min: [0.1, 0.2],
    max: [0.9, 1],
    std: [0.1, 0.1],
    quantileLower: [0.25, 0.3],
    quantileUpper: [0.75, 0.8],
  };
}

function byTestId(container: HTMLElement, testId: string) {
  return container.querySelector(`[data-testid="${testId}"]`);
}

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => {
      root.unmount();
    });
  }
  mountedRoots = [];

  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('SpectraWebGLScene', () => {
  it('mounts interaction and line layers for individual spectra', async () => {
    const container = await render(<SpectraWebGLScene {...baseProps()} />);

    expect(byTestId(container, 'camera')).toBeTruthy();
    expect(byTestId(container, 'x-zoom')).toBeTruthy();
    expect(byTestId(container, 'axes')).toBeTruthy();
    expect(byTestId(container, 'interaction')).toBeTruthy();
    expect(byTestId(container, 'lines')).toBeTruthy();
    expect(byTestId(container, 'aggregated-area')).toBeNull();
    expect(byTestId(container, 'grouped-areas')).toBeNull();
  });

  it('mounts aggregate areas without individual interaction or lines', async () => {
    const container = await render(
      <SpectraWebGLScene
        {...baseProps()}
        aggregatedStats={areaStats()}
      />
    );

    expect(byTestId(container, 'aggregated-area')).toBeTruthy();
    expect(byTestId(container, 'interaction')).toBeNull();
    expect(byTestId(container, 'lines')).toBeNull();
  });

  it('mounts grouped areas without individual interaction or lines', async () => {
    const container = await render(
      <SpectraWebGLScene
        {...baseProps()}
        groupedStats={{
          wavelengths: [1000, 1100],
          groups: new Map([['a', areaStats()]]),
          colors: ['#123456'],
        }}
      />
    );

    expect(byTestId(container, 'grouped-areas')).toBeTruthy();
    expect(byTestId(container, 'interaction')).toBeNull();
    expect(byTestId(container, 'lines')).toBeNull();
  });
});
