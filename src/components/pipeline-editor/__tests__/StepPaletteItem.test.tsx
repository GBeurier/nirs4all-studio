/**
 * @vitest-environment jsdom
 */

import { act, type HTMLAttributes, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraggableStep } from "../StepPaletteItem";
import { PipelineDndContext } from "../usePipelineDnd";

const mocks = vi.hoisted(() => ({ useDraggable: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@dnd-kit/core", () => ({
  useDraggable: mocks.useDraggable,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/motion", () => ({
  motion: {
    div: ({ children, initial: _initial, animate: _animate, whileHover: _hover,
      whileTap: _tap, transition: _transition, ...props }: HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const dnd = { activeData: null, dropIndicator: null, isDragging: false, activeId: null };
const option = {
  name: "TSNE",
  description: "Embedding",
  classPath: "sklearn.manifold.TSNE",
  defaultParams: {},
};

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("DraggableStep", () => {
  it("cannot drag or add an unavailable operator", async () => {
    mocks.useDraggable.mockReturnValue({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), isDragging: false });
    const onDoubleClick = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PipelineDndContext.Provider value={dnd}>
          <DraggableStep
            stepType="preprocessing"
            option={option}
            onDoubleClick={onDoubleClick}
            isUnavailable
            unavailableReason="No predictive transform"
          />
        </PipelineDndContext.Provider>,
      );
    });

    expect(mocks.useDraggable).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }));
    const item = container.querySelector('[aria-disabled="true"]');
    expect(item).not.toBeNull();
    item?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onDoubleClick).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });
});
