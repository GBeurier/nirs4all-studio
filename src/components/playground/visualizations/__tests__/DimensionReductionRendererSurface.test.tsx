/**
 * @vitest-environment jsdom
 */

import type { ComponentProps, ReactNode } from 'react';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DimensionReductionRendererSurface } from '../DimensionReductionRendererSurface';

vi.mock('@/components/playground/SelectionTools', () => ({
  SelectionContainer: ({
    children,
    mode,
    onSelectionComplete,
    onBackgroundClick,
    enabled,
    className,
  }: {
    children: ReactNode;
    mode: string;
    onSelectionComplete: (result: unknown, modifiers: { shift: boolean; ctrl: boolean }) => void;
    onBackgroundClick?: (modifiers: { shift: boolean; ctrl: boolean }) => void;
    enabled: boolean;
    className: string;
  }) => (
    <section
      data-testid="selection-container"
      data-mode={mode}
      data-enabled={String(enabled)}
      data-class-name={className}
    >
      <button
        type="button"
        data-testid="complete-selection"
        onClick={() => onSelectionComplete({
          start: { x: 0, y: 0 },
          end: { x: 12, y: 18 },
          bounds: { minX: 0, minY: 0, maxX: 12, maxY: 18 },
        }, { shift: true, ctrl: false })}
      />
      <button
        type="button"
        data-testid="background-click"
        onClick={() => onBackgroundClick?.({ shift: false, ctrl: true })}
      />
      {children}
    </section>
  ),
}));

vi.mock('../DimensionReductionTooltip', () => ({
  DimensionReductionFloatingTooltip: ({
    enableHover,
    point,
    containerWidth,
    xLabel,
    yLabel,
    zLabel,
    showZ,
  }: {
    enableHover: boolean;
    point: { name: string } | null;
    containerWidth?: number;
    xLabel: string;
    yLabel: string;
    zLabel: string;
    showZ: boolean;
  }) => (
    <div
      data-testid="floating-tooltip"
      data-enable-hover={String(enableHover)}
      data-point-name={point?.name ?? ''}
      data-container-width={String(containerWidth ?? '')}
      data-x-label={xLabel}
      data-y-label={yLabel}
      data-z-label={zLabel}
      data-show-z={String(showZ)}
    />
  ),
}));

vi.mock('../WebglIndicatorBadge', () => ({
  WebglIndicatorBadge: ({
    position,
    label,
  }: {
    position: string;
    label?: string;
  }) => (
    <div
      data-testid="webgl-badge"
      data-position={position}
      data-label={label ?? ''}
    />
  ),
}));

vi.mock('../scatter', async () => {
  const React = await import('react');

  function scatterDataProps(props: {
    points?: unknown[];
    indices?: unknown[];
    useSelectionContext?: boolean;
    pointSize?: number;
    showGrid?: boolean;
    xLabel?: string;
    yLabel?: string;
    zLabel?: string;
    clearOnBackgroundClick?: boolean;
    preserveAspectRatio?: boolean;
    className?: string;
  }) {
    return {
      'data-point-count': String(props.points?.length ?? 0),
      'data-index-count': String(props.indices?.length ?? 0),
      'data-use-selection': String(props.useSelectionContext),
      'data-point-size': String(props.pointSize),
      'data-show-grid': String(props.showGrid),
      'data-x-label': props.xLabel ?? '',
      'data-y-label': props.yLabel ?? '',
      'data-z-label': props.zLabel ?? '',
      'data-clear-background': String(props.clearOnBackgroundClick),
      'data-preserve-aspect': String(props.preserveAspectRatio),
      'data-class-name': props.className ?? '',
    };
  }

  return {
    ScatterPureWebGL2D: (props: Record<string, unknown>) => (
      <div data-testid="scatter-webgl-2d" {...scatterDataProps(props)} />
    ),
    ScatterRegl2D: (props: Record<string, unknown>) => (
      <div data-testid="scatter-regl-2d" {...scatterDataProps(props)} />
    ),
    ScatterPureWebGL3D: React.forwardRef((_props: Record<string, unknown>, _ref) => (
      <div data-testid="scatter-webgl-3d" {...scatterDataProps(_props)} />
    )),
    ScatterRegl3D: React.forwardRef((_props: Record<string, unknown>, _ref) => (
      <div data-testid="scatter-regl-3d" {...scatterDataProps(_props)} />
    )),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type SurfaceProps = ComponentProps<typeof DimensionReductionRendererSurface>;

let mountedContainers: HTMLDivElement[] = [];

async function render(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

function createSurfaceProps(overrides: Partial<SurfaceProps> = {}): SurfaceProps {
  return {
    viewMode: '2d',
    rendererType: 'webgl',
    selectionTool: 'click',
    selectionEnabled: true,
    useSelectionContext: true,
    webgl2DProps: {
      points: [[1, 2]] as [number, number][],
      indices: [3],
      colors: ['#123456'],
      values: [0.5],
    },
    webgl3DProps: {
      points: [[1, 2, 3]] as [number, number, number][],
      indices: [4],
      colors: ['#abcdef'],
      values: [0.7],
    },
    scatter3DRef: createRef(),
    recharts2DView: <button type="button" data-testid="recharts-2d-view">2D Recharts</button>,
    recharts3DView: <div data-testid="recharts-3d-view">3D Recharts</div>,
    pointSize: 9,
    showGrid: true,
    preserveAspectRatio: false,
    axisLabels: {
      x: 'PC1',
      y: 'PC2',
      z: 'PC3',
    },
    enableHover: true,
    hoveredPoint: {
      x: 1,
      y: 2,
      z: 3,
      index: 3,
      name: 'Sample A',
    },
    mousePosition: { x: 20, y: 30 },
    containerWidth: 640,
    onRechartsSelectionComplete: vi.fn(),
    onWebglSelectionComplete: vi.fn(),
    on3DSelectionComplete: vi.fn(),
    onBackgroundClick: vi.fn(),
    onRechartsBackgroundClick: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('DimensionReductionRendererSurface', () => {
  it('renders the 2D WebGL branch with overlays and routes selection to the WebGL handler', async () => {
    const props = createSurfaceProps({
      rendererType: 'webgl',
      viewMode: '2d',
      selectionTool: 'click',
      preserveAspectRatio: true,
    });
    const { container, root } = await render(<DimensionReductionRendererSurface {...props} />);

    expect(container.querySelector('[data-testid="webgl-badge"]')?.getAttribute('data-label')).toBe('WebGL');
    expect(container.querySelector('[data-testid="floating-tooltip"]')?.getAttribute('data-show-z')).toBe('false');
    expect(container.querySelector('[data-testid="floating-tooltip"]')?.getAttribute('data-point-name')).toBe('Sample A');

    const scatter = container.querySelector('[data-testid="scatter-webgl-2d"]') as HTMLElement;
    expect(scatter).not.toBeNull();
    expect(scatter.getAttribute('data-clear-background')).toBe('true');
    expect(scatter.getAttribute('data-preserve-aspect')).toBe('true');
    expect(scatter.getAttribute('data-x-label')).toBe('PC1');
    expect(scatter.getAttribute('data-y-label')).toBe('PC2');
    expect(container.querySelector('[data-testid="scatter-regl-2d"]')).toBeNull();
    expect(container.querySelector('[data-testid="scatter-webgl-3d"]')).toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="complete-selection"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="background-click"]') as HTMLButtonElement).click();
    });

    expect(props.onWebglSelectionComplete).toHaveBeenCalledTimes(1);
    expect(props.on3DSelectionComplete).not.toHaveBeenCalled();
    expect(props.onRechartsSelectionComplete).not.toHaveBeenCalled();
    expect(props.onBackgroundClick).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the 3D Regl branch with 3D tooltip state and routes selection to the 3D handler', async () => {
    const props = createSurfaceProps({
      rendererType: 'regl',
      viewMode: '3d',
      selectionTool: 'box',
      selectionEnabled: false,
      showGrid: false,
      useSelectionContext: false,
    });
    const { container, root } = await render(<DimensionReductionRendererSurface {...props} />);

    expect(container.querySelector('[data-testid="webgl-badge"]')?.getAttribute('data-label')).toBe('Regl');
    expect(container.querySelector('[data-testid="floating-tooltip"]')?.getAttribute('data-show-z')).toBe('true');
    expect(container.querySelector('[data-testid="selection-container"]')?.getAttribute('data-mode')).toBe('box');
    expect(container.querySelector('[data-testid="selection-container"]')?.getAttribute('data-enabled')).toBe('false');

    const scatter = container.querySelector('[data-testid="scatter-regl-3d"]') as HTMLElement;
    expect(scatter).not.toBeNull();
    expect(scatter.getAttribute('data-clear-background')).toBe('false');
    expect(scatter.getAttribute('data-use-selection')).toBe('false');
    expect(scatter.getAttribute('data-show-grid')).toBe('false');
    expect(scatter.getAttribute('data-z-label')).toBe('PC3');
    expect(container.querySelector('[data-testid="scatter-webgl-2d"]')).toBeNull();
    expect(container.querySelector('[data-testid="recharts-3d-view"]')).toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="complete-selection"]') as HTMLButtonElement).click();
    });

    expect(props.on3DSelectionComplete).toHaveBeenCalledTimes(1);
    expect(props.onWebglSelectionComplete).not.toHaveBeenCalled();
    expect(props.onRechartsSelectionComplete).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the 2D Regl branch through the WebGL-family selection handler', async () => {
    const props = createSurfaceProps({
      rendererType: 'regl',
      viewMode: '2d',
      selectionTool: 'box',
    });
    const { container, root } = await render(<DimensionReductionRendererSurface {...props} />);

    expect(container.querySelector('[data-testid="webgl-badge"]')?.getAttribute('data-label')).toBe('Regl');
    expect(container.querySelector('[data-testid="floating-tooltip"]')?.getAttribute('data-show-z')).toBe('false');

    const scatter = container.querySelector('[data-testid="scatter-regl-2d"]') as HTMLElement;
    expect(scatter).not.toBeNull();
    expect(scatter.getAttribute('data-clear-background')).toBe('false');
    expect(scatter.getAttribute('data-preserve-aspect')).toBe('false');
    expect(container.querySelector('[data-testid="scatter-webgl-2d"]')).toBeNull();
    expect(container.querySelector('[data-testid="recharts-2d-view"]')).toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="complete-selection"]') as HTMLButtonElement).click();
    });

    expect(props.onWebglSelectionComplete).toHaveBeenCalledTimes(1);
    expect(props.on3DSelectionComplete).not.toHaveBeenCalled();
    expect(props.onRechartsSelectionComplete).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the 3D WebGL branch with axes and routes selection to the 3D handler', async () => {
    const props = createSurfaceProps({
      rendererType: 'webgl',
      viewMode: '3d',
      pointSize: 11,
    });
    const { container, root } = await render(<DimensionReductionRendererSurface {...props} />);

    expect(container.querySelector('[data-testid="webgl-badge"]')?.getAttribute('data-label')).toBe('WebGL');
    expect(container.querySelector('[data-testid="floating-tooltip"]')?.getAttribute('data-show-z')).toBe('true');

    const scatter = container.querySelector('[data-testid="scatter-webgl-3d"]') as HTMLElement;
    expect(scatter).not.toBeNull();
    expect(scatter.getAttribute('data-point-size')).toBe('11');
    expect(scatter.getAttribute('data-x-label')).toBe('PC1');
    expect(scatter.getAttribute('data-y-label')).toBe('PC2');
    expect(scatter.getAttribute('data-z-label')).toBe('PC3');
    expect(scatter.getAttribute('data-clear-background')).toBe('true');
    expect(container.querySelector('[data-testid="scatter-regl-3d"]')).toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="complete-selection"]') as HTMLButtonElement).click();
    });

    expect(props.on3DSelectionComplete).toHaveBeenCalledTimes(1);
    expect(props.onWebglSelectionComplete).not.toHaveBeenCalled();
    expect(props.onRechartsSelectionComplete).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the 2D Recharts branch without WebGL overlays and keeps Recharts background routing', async () => {
    const props = createSurfaceProps({
      rendererType: 'recharts',
      viewMode: '2d',
      selectionTool: 'lasso',
    });
    const { container, root } = await render(<DimensionReductionRendererSurface {...props} />);

    expect(container.querySelector('[data-testid="webgl-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="floating-tooltip"]')).toBeNull();
    expect(container.querySelector('[data-testid="recharts-2d-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="selection-container"]')?.getAttribute('data-mode')).toBe('lasso');
    expect(container.querySelector('[data-testid="scatter-webgl-2d"]')).toBeNull();
    expect(container.querySelector('[data-testid="scatter-regl-2d"]')).toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="complete-selection"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="recharts-2d-view"]') as HTMLButtonElement).click();
    });

    expect(props.onRechartsSelectionComplete).toHaveBeenCalledTimes(1);
    expect(props.onWebglSelectionComplete).not.toHaveBeenCalled();
    expect(props.on3DSelectionComplete).not.toHaveBeenCalled();
    expect(props.onRechartsBackgroundClick).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the 3D Recharts branch without WebGL overlays and routes selection to Recharts', async () => {
    const props = createSurfaceProps({
      rendererType: 'recharts',
      viewMode: '3d',
      selectionTool: 'click',
    });
    const { container, root } = await render(<DimensionReductionRendererSurface {...props} />);

    expect(container.querySelector('[data-testid="webgl-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="floating-tooltip"]')).toBeNull();
    expect(container.querySelector('[data-testid="recharts-3d-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="selection-container"]')?.getAttribute('data-mode')).toBe('click');
    expect(container.querySelector('[data-testid="scatter-webgl-3d"]')).toBeNull();
    expect(container.querySelector('[data-testid="scatter-regl-3d"]')).toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="complete-selection"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="background-click"]') as HTMLButtonElement).click();
    });

    expect(props.onRechartsSelectionComplete).toHaveBeenCalledTimes(1);
    expect(props.onWebglSelectionComplete).not.toHaveBeenCalled();
    expect(props.on3DSelectionComplete).not.toHaveBeenCalled();
    expect(props.onBackgroundClick).toHaveBeenCalledTimes(1);
    expect(props.onRechartsBackgroundClick).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
