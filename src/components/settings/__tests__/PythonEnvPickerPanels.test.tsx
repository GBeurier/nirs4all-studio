/**
 * @vitest-environment jsdom
 */

import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";
import {
  BusyProgressPanel,
  PythonEnvStatusCard,
} from "../PythonEnvPickerPanels";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{
  container: HTMLDivElement;
  unmount: () => Promise<void>;
}> = [];

async function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  const view = {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
  mounted.push(view);
  return view;
}

afterEach(async () => {
  for (const view of mounted.splice(0)) {
    await view.unmount();
  }
});

describe("PythonEnvPickerPanels", () => {
  it("renders the current runtime summary using pure display helpers", async () => {
    const onOpenReview = vi.fn();
    const onOpenDialog = vi.fn();
    const runtimeDisplay: PythonRuntimeDisplayState = {
      runtimeKind: "custom",
      label: "User-selected runtime",
      isReadOnly: false,
      isBundledEmbedded: false,
      isBundledExternal: false,
      isPyInstaller: false,
    };

    const view = await render(
      <PythonEnvStatusCard
        isReady
        runtimeVersion="Python 3.13.1 (main, Apr 18 2026)"
        runtimeDisplay={runtimeDisplay}
        runningPythonPath={"C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python313\\python.exe"}
        missingCoreCount={0}
        missingOptionalCount={2}
        isSettingUp={false}
        readyLabel="Ready"
        notReadyLabel="Not ready"
        reviewPackagesLabel="Review packages"
        changeLabel="Change"
        onOpenReview={onOpenReview}
        onOpenDialog={onOpenDialog}
      />,
    );

    expect(view.container.textContent).toContain("Python 3.13.1");
    expect(view.container.textContent).toContain("Ready");
    expect(view.container.textContent).toContain("User-selected runtime");
    expect(view.container.textContent).toContain("Running Python");
    expect(view.container.textContent).toContain("...\\Python\\Python313\\python.exe");
    expect(view.container.textContent).toContain("2 optional packages missing");

    const reviewButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Review packages"),
    );
    const changeButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Change"),
    );

    await act(async () => {
      reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      changeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenReview).toHaveBeenCalledTimes(1);
    expect(onOpenDialog).toHaveBeenCalledTimes(1);
  });

  it("renders busy progress text without component state", async () => {
    const view = await render(
      <BusyProgressPanel
        title="Inspecting environment"
        detail="Reading Python details."
        progress={42}
      />,
    );

    expect(view.container.textContent).toContain("Inspecting environment");
    expect(view.container.textContent).toContain("Reading Python details.");
  });
});
