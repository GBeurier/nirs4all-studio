/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelSelector } from "./ModelSelector";
import { readPersistedArchiveV2Selection } from "@/lib/archiveV2Selection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => Promise<void>) | null = null;

async function renderSelector(onSelect: ReturnType<typeof vi.fn>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ModelSelector selectedModel={null} onSelect={onSelect} />);
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return container;
}

async function setInput(container: HTMLElement, id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!
      .set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => localStorage.clear());

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  vi.clearAllMocks();
});

describe("Archive V2 ModelSelector", () => {
  it("persists and selects only the explicit Archive V2 contract", async () => {
    const onSelect = vi.fn();
    const container = await renderSelector(onSelect);

    await setInput(container, "archive-workspace-id", "workspace-a");
    await setInput(container, "archive-ref", "models/calibration.n4a");
    await setInput(container, "archive-sha256", "a".repeat(64));
    await setInput(container, "archive-n-features", "2");
    await setInput(container, "archive-target-names", "protein, moisture");

    const save = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Verify and select"))!;
    await act(async () => save.click());

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      kind: "persisted_archive_v2",
      archive_ref: "models/calibration.n4a",
      n_features: 2,
      target_names: ["protein", "moisture"],
    }));
    expect(readPersistedArchiveV2Selection()?.archive_sha256).toBe("a".repeat(64));
  });

  it("refuses an absolute legacy-style path", async () => {
    const onSelect = vi.fn();
    const container = await renderSelector(onSelect);

    await setInput(container, "archive-workspace-id", "workspace-a");
    await setInput(container, "archive-ref", "/tmp/model.joblib");
    await setInput(container, "archive-sha256", "a".repeat(64));
    await setInput(container, "archive-n-features", "2");
    await setInput(container, "archive-target-names", "protein");
    const save = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Verify and select"))!;
    await act(async () => save.click());

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("Invalid Archive V2 selection");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
