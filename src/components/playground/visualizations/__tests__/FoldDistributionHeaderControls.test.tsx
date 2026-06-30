/**
 * @vitest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FoldDistributionHeaderControls } from '../FoldDistributionHeaderControls';

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    className,
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) => (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <div data-testid="select" data-value={value}>
      {children}
      <button type="button" data-testid="select-counts" onClick={() => onValueChange('counts')} />
      <button type="button" data-testid="select-distribution" onClick={() => onValueChange('distribution')} />
      <button type="button" data-testid="select-both" onClick={() => onValueChange('both')} />
    </div>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <div data-testid={`select-item-${value}`}>{children}</div>
  ),
  SelectTrigger: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="select-trigger" className={className}>{children}</div>
  ),
  SelectValue: () => <span data-testid="select-value" />,
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div data-testid="tooltip">{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div data-testid="tooltip-content">{children}</div>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <div data-testid="tooltip-provider">{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../FoldDistributionSettingsMenu', () => ({
  FoldDistributionSettingsMenu: ({
    showLegend,
    showYLegend,
    showMeanLine,
    disableYLegend,
    disableMeanLine,
    onShowLegendChange,
    onShowYLegendChange,
    onShowMeanLineChange,
  }: {
    showLegend: boolean;
    showYLegend: boolean;
    showMeanLine: boolean;
    disableYLegend: boolean;
    disableMeanLine: boolean;
    onShowLegendChange: (checked: boolean) => void;
    onShowYLegendChange: (checked: boolean) => void;
    onShowMeanLineChange: (checked: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="settings-menu"
      data-show-legend={String(showLegend)}
      data-show-y-legend={String(showYLegend)}
      data-show-mean-line={String(showMeanLine)}
      data-disable-y-legend={String(disableYLegend)}
      data-disable-mean-line={String(disableMeanLine)}
      onClick={() => {
        onShowLegendChange(!showLegend);
        onShowYLegendChange(!showYLegend);
        onShowMeanLineChange(!showMeanLine);
      }}
    />
  ),
}));

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

const defaultProps = {
  splitterName: 'KFold',
  foldCount: 3,
  viewMode: 'counts' as const,
  hasYStats: true,
  selectedFold: null,
  showLegend: true,
  showYLegend: false,
  showMeanLine: false,
  disableYLegend: false,
  disableMeanLine: false,
  onViewModeChange: vi.fn(),
  onClearFoldSelection: vi.fn(),
  onShowLegendChange: vi.fn(),
  onShowYLegendChange: vi.fn(),
  onShowMeanLineChange: vi.fn(),
  onExport: vi.fn(),
};

afterEach(() => {
  vi.clearAllMocks();
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('FoldDistributionHeaderControls', () => {
  it('renders title, view choices, settings state, and export action', async () => {
    const { container, root } = await render(
      <FoldDistributionHeaderControls {...defaultProps} />
    );

    expect(container.textContent).toContain('KFold (3 folds)');
    expect(container.querySelector('[data-testid="select"]')?.getAttribute('data-value')).toBe('counts');
    expect(container.textContent).toContain('Sample Counts');
    expect(container.textContent).toContain('Y Distribution');
    expect(container.textContent).toContain('Both');
    expect(container.querySelector('[data-testid="settings-menu"]')?.getAttribute('data-disable-y-legend')).toBe('false');
    expect(container.querySelector('[data-testid="settings-menu"]')?.getAttribute('data-disable-mean-line')).toBe('false');

    await act(async () => {
      (container.querySelector('[data-testid="select-distribution"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="settings-menu"]') as HTMLButtonElement).click();
      (container.querySelector('.h-7.px-2') as HTMLButtonElement).click();
    });

    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('distribution');
    expect(defaultProps.onShowLegendChange).toHaveBeenCalledWith(false);
    expect(defaultProps.onShowYLegendChange).toHaveBeenCalledWith(true);
    expect(defaultProps.onShowMeanLineChange).toHaveBeenCalledWith(true);
    expect(defaultProps.onExport).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('hides Y view choices without stats and exposes clear selection when a fold is selected', async () => {
    const onClearFoldSelection = vi.fn();
    const { container, root } = await render(
      <FoldDistributionHeaderControls
        {...defaultProps}
        hasYStats={false}
        selectedFold={1}
        disableYLegend
        disableMeanLine
        onClearFoldSelection={onClearFoldSelection}
      />
    );

    expect(container.textContent).toContain('Sample Counts');
    expect(container.textContent).not.toContain('Y Distribution');
    expect(container.textContent).not.toContain('Both');
    expect(container.querySelector('[data-testid="settings-menu"]')?.getAttribute('data-disable-y-legend')).toBe('true');
    expect(container.querySelector('[data-testid="settings-menu"]')?.getAttribute('data-disable-mean-line')).toBe('true');

    const clearButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'Clear') as HTMLButtonElement;
    expect(clearButton).toBeDefined();

    await act(async () => {
      clearButton.click();
    });

    expect(onClearFoldSelection).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
