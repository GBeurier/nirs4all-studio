/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedWrite } from "./useDebouncedWrite";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let cancelWrite: (() => void) | null = null;

function Probe({ write, skipInitialWrite, scopeKey }: { write: (() => void) | null; skipInitialWrite?: boolean; scopeKey?: string }) {
  cancelWrite = useDebouncedWrite(write, { skipInitialWrite, scopeKey }).cancel;
  return null;
}

async function mount(write: (() => void) | null, skipInitialWrite = false, scopeKey?: string) {
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<Probe write={write} skipInitialWrite={skipInitialWrite} scopeKey={scopeKey} />); });
  return {
    rerender: (next: (() => void) | null, nextScopeKey = scopeKey) => act(async () => {
      root.render(<Probe write={next} skipInitialWrite={skipInitialWrite} scopeKey={nextScopeKey} />);
    }),
    unmount: () => act(async () => root.unmount()),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cancelWrite = null;
});

describe("useDebouncedWrite", () => {
  it("collapses rapid edits into one write of the latest state", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = await mount(first);
    await view.rerender(second);
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(second).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("flushes a pending write on unmount and on page hide", async () => {
    const onUnmount = vi.fn();
    const view = await mount(onUnmount);
    await view.unmount();
    expect(onUnmount).toHaveBeenCalledTimes(1);

    const onHide = vi.fn();
    const second = await mount(onHide);
    window.dispatchEvent(new Event("pagehide"));
    expect(onHide).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(onHide).toHaveBeenCalledTimes(1);
    await second.unmount();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("discards a pending write when there is nothing left to persist or it is cancelled", async () => {
    const stale = vi.fn();
    const view = await mount(stale);
    await view.rerender(null);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(stale).not.toHaveBeenCalled();

    const cancelled = vi.fn();
    await view.rerender(cancelled);
    act(() => cancelWrite?.());
    await view.unmount();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("flushes the previous target's pending write when the scope changes", async () => {
    const forA = vi.fn();
    const forB = vi.fn();
    const view = await mount(forA, false, "a");
    await view.rerender(forB, "b");
    expect(forA).toHaveBeenCalledTimes(1);
    expect(forB).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(forB).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("can skip the write for the state that was just loaded", async () => {
    const initial = vi.fn();
    const next = vi.fn();
    const view = await mount(initial, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(initial).not.toHaveBeenCalled();
    await view.rerender(next);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(next).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
