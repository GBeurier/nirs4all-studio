/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInspectorChartViewport } from "./useInspectorChartViewport";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const originalResizeObserver = globalThis.ResizeObserver;

let mountedContainers: HTMLDivElement[] = [];

class MockResizeObserver implements ResizeObserver {
  static latest: MockResizeObserver | null = null;

  readonly observedElements: Element[] = [];
  readonly observe: ResizeObserver["observe"] = vi.fn((target: Element) => {
    this.observedElements.push(target);
  });
  readonly unobserve: ResizeObserver["unobserve"] = vi.fn();
  readonly disconnect: ResizeObserver["disconnect"] = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.latest = this;
  }

  emit(width: number, height: number) {
    this.callback([
      {
        contentRect: { width, height },
      } as ResizeObserverEntry,
    ], this);
  }
}

function Probe({
  initialWidth,
  initialHeight,
}: {
  initialWidth?: number;
  initialHeight?: number;
}) {
  const { viewportRef, dimensions } = useInspectorChartViewport({
    initialWidth,
    initialHeight,
  });

  return (
    <div ref={viewportRef} data-testid="viewport">
      {dimensions.width}x{dimensions.height}
    </div>
  );
}

async function render(element: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
  MockResizeObserver.latest = null;
  globalThis.ResizeObserver = originalResizeObserver;
  vi.clearAllMocks();
});

describe("useInspectorChartViewport", () => {
  it("starts from fallback dimensions and updates from ResizeObserver", async () => {
    globalThis.ResizeObserver = MockResizeObserver;

    const { container, root } = await render(
      <Probe initialWidth={320} initialHeight={180} />,
    );

    expect(container.textContent).toBe("320x180");
    expect(MockResizeObserver.latest?.observe).toHaveBeenCalledTimes(1);

    await act(async () => {
      MockResizeObserver.latest?.emit(640, 360);
    });

    expect(container.textContent).toBe("640x360");

    await act(async () => {
      root.unmount();
    });

    expect(MockResizeObserver.latest?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps fallback dimensions when ResizeObserver is unavailable", async () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;

    const { container, root } = await render(
      <Probe initialWidth={250} initialHeight={120} />,
    );

    expect(container.textContent).toBe("250x120");

    await act(async () => {
      root.unmount();
    });
  });
});
