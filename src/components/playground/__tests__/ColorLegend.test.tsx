/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { buildPlaygroundTargetView } from '@/lib/playground/canvasData';
import { type ColorContext, DEFAULT_GLOBAL_COLOR_CONFIG } from '@/lib/playground/colorConfig';
import type { TargetValue } from '@/types/spectral';

import { ColorLegend, InlineColorLegend } from '../ColorLegend';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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

/** Colour context as the canvas builds it from a dataset's target values. */
function targetColorContext(y: TargetValue[]): ColorContext {
  const view = buildPlaygroundTargetView(
    { wavelengths: [1100, 1200], spectra: y.map(() => [0.1, 0.2]), y },
    null,
  );
  return {
    y: view.yValues,
    yMin: view.yMin,
    yMax: view.yMax,
    targetType: view.targetType,
    classLabels: view.classLabels,
    classLabelMap: view.classLabelMap,
  };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('ColorLegend with missing target values', () => {
  // The backend sends a missing target value as JSON `null`.
  const y: TargetValue[] = [11.2423, 9.5633, 12.9194, null, 5.78, null, 14.43];

  it('renders the observed range and flags the samples without a value', async () => {
    const { container, root } = await render(
      <ColorLegend config={DEFAULT_GLOBAL_COLOR_CONFIG} context={targetColorContext(y)} />
    );

    expect(container.textContent).toContain('5.78');
    expect(container.textContent).toContain('14.43');
    expect(container.textContent).toContain('No value (2)');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the inline legend used inside the charts', async () => {
    const { container, root } = await render(
      <InlineColorLegend config={DEFAULT_GLOBAL_COLOR_CONFIG} context={targetColorContext(y)} />
    );

    expect(container.textContent).toContain('5.78');
    expect(container.textContent).toContain('14.43');
    expect(container.textContent).toContain('No value (2)');

    await act(async () => {
      root.unmount();
    });
  });

  it('does not mention missing values when every sample has a target value', async () => {
    const { container, root } = await render(
      <ColorLegend config={DEFAULT_GLOBAL_COLOR_CONFIG} context={targetColorContext([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5])} />
    );

    expect(container.textContent).toContain('1.50');
    expect(container.textContent).toContain('12.50');
    expect(container.textContent).not.toContain('No value');

    await act(async () => {
      root.unmount();
    });
  });
});
