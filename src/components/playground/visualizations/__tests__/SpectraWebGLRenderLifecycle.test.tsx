/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SelectionProvider } from '@/context/SelectionContext';
import { useSelection, type SelectionContextValue } from '@/context/useSelection';
import { SpectraWebGL } from '../SpectraWebGL';
import type { SpectraWebGLSceneProps } from '../SpectraWebGLScene';

const captured = vi.hoisted(() => ({
  frameloop: undefined as string | undefined,
  scene: undefined as SpectraWebGLSceneProps | undefined,
}));

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, frameloop }: { children: ReactNode; frameloop?: string }) => {
    captured.frameloop = frameloop;
    return <div>{children}</div>;
  },
}));
vi.mock('@/lib/playground/renderOptimizer', () => ({
  detectDeviceCapabilities: () => ({ webglSupported: true }),
}));
vi.mock('../SpectraWebGLScene', () => ({
  SpectraWebGLScene: (props: SpectraWebGLSceneProps) => {
    captured.scene = props;
    return null;
  },
}));
vi.mock('../SpectraWebGLHoverTooltip', () => ({ SpectraWebGLHoverTooltip: () => null }));
vi.mock('../SpectraWebGLQualityControl', () => ({ SpectraWebGLQualityControl: () => null }));
vi.mock('../SpectraWebGLStatusOverlays', () => ({ SpectraWebGLStatusOverlays: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let selection: SelectionContextValue;

function SelectionProbe() {
  selection = useSelection();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  captured.scene = undefined;
  captured.frameloop = undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  localStorage.clear();
  vi.useRealTimers();
});

describe('SpectraWebGL demand rendering', () => {
  it('keeps zoom, hover and selection flowing to the scene without a continuous frame loop', async () => {
    const onHover = vi.fn();
    const onSampleClick = vi.fn();
    await act(async () => {
      root.render(
        <SelectionProvider>
          <SelectionProbe />
          <SpectraWebGL
            spectra={[[0, 1, 2], [2, 1, 0]]}
            wavelengths={[1000, 1010, 1020]}
            onHover={onHover}
            onSampleClick={onSampleClick}
          />
        </SelectionProvider>,
      );
    });
    expect(captured.frameloop).toBe('demand');
    expect(captured.scene?.xViewRange).toEqual([1000, 1020]);

    await act(async () => {
      captured.scene!.onXViewRangeChange([1004, 1016]);
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(captured.scene?.xViewRange).toEqual([1004, 1016]);

    await act(async () => { captured.scene!.onHover(1); });
    expect(onHover).toHaveBeenCalledWith(1);
    expect(captured.scene?.hoveredIdx).toBe(1);

    const click = new MouseEvent('click', { detail: 1 });
    await act(async () => { captured.scene!.onClick(0, click); });
    expect(onSampleClick).toHaveBeenCalledWith(0, click);
    expect(captured.scene?.selectedIndices).toEqual(new Set([0]));

    await act(async () => { selection.pin([1]); });
    expect(captured.scene?.pinnedIndices).toEqual(new Set([1]));
    await act(async () => { captured.scene!.onHover(null); });
    expect(captured.scene?.hoveredIdx).toBeNull();
    expect(captured.scene?.xViewRange).toEqual([1004, 1016]);
    expect(captured.frameloop).toBe('demand');
  });
});
