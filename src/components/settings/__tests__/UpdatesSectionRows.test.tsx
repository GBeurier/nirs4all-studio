/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Nirs4allUpdateRow, WebappUpdateRow } from "../UpdatesSectionRows";
import type {
  Nirs4allUpdateRowState,
  WebappUpdateRowState,
} from "../UpdatesSectionLogic";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

async function render(element: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ container, root });

  await act(async () => {
    root.render(element);
  });

  return container;
}

async function click(button: HTMLButtonElement | null) {
  expect(button).not.toBeNull();

  await act(async () => {
    button?.click();
  });
}

function createWebappRow(
  overrides: Partial<WebappUpdateRowState> = {},
): WebappUpdateRowState {
  return {
    action: "update",
    canApplyInPlace: true,
    currentVersion: "1.0.0",
    downloadProgressPercent: 0,
    hasStagedUpdate: false,
    hasUpdate: true,
    installerUrl: "https://example.test/installer",
    isPrerelease: false,
    showTargetVersion: true,
    targetVersion: "1.1.0",
    ...overrides,
  };
}

function createNirs4allRow(
  overrides: Partial<Nirs4allUpdateRowState> = {},
): Nirs4allUpdateRowState {
  return {
    action: "update",
    currentVersion: "0.9.0",
    isActionDisabled: false,
    latestVersion: "0.10.0",
    showTargetVersion: true,
    ...overrides,
  };
}

afterEach(async () => {
  for (const { container, root } of mountedRoots.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  vi.clearAllMocks();
});

describe("WebappUpdateRow", () => {
  it("renders the prepared version state and opens the update dialog CTA", async () => {
    const onOpenDialog = vi.fn();
    const container = await render(
      <WebappUpdateRow
        row={createWebappRow({ isPrerelease: true })}
        onOpenDialog={onOpenDialog}
        onOpenInstaller={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("nirs4all Studio");
    expect(container.textContent).toContain("Current: 1.0.0 → 1.1.0");
    expect(container.textContent).toContain("pre-release");
    expect(container.textContent).toContain("Update");

    await click(container.querySelector("button"));

    expect(onOpenDialog).toHaveBeenCalledTimes(1);
  });

  it("renders the installer CTA from the prepared installer state", async () => {
    const onOpenInstaller = vi.fn();
    const container = await render(
      <WebappUpdateRow
        row={createWebappRow({ action: "installer" })}
        onOpenDialog={vi.fn()}
        onOpenInstaller={onOpenInstaller}
      />,
    );

    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Get installer");
    expect(button?.disabled).toBe(false);

    await click(button);

    expect(onOpenInstaller).toHaveBeenCalledTimes(1);
  });

  it("disables the installer CTA when no installer URL is prepared", async () => {
    const container = await render(
      <WebappUpdateRow
        row={createWebappRow({ action: "installer", installerUrl: null })}
        onOpenDialog={vi.fn()}
        onOpenInstaller={vi.fn()}
      />,
    );

    expect(container.querySelector("button")?.disabled).toBe(true);
  });
});

describe("Nirs4allUpdateRow", () => {
  it("renders the prepared library update state and opens the dialog CTA", async () => {
    const onOpenDialog = vi.fn();
    const container = await render(
      <Nirs4allUpdateRow
        row={createNirs4allRow()}
        onOpenDialog={onOpenDialog}
      />,
    );

    expect(container.textContent).toContain("nirs4all Library");
    expect(container.textContent).toContain("Current: 0.9.0 → 0.10.0");

    await click(container.querySelector("button"));

    expect(onOpenDialog).toHaveBeenCalledTimes(1);
  });

  it("renders the disabled install CTA for a read-only missing install", async () => {
    const container = await render(
      <Nirs4allUpdateRow
        row={createNirs4allRow({
          action: "install",
          currentVersion: null,
          isActionDisabled: true,
          showTargetVersion: false,
        })}
        onOpenDialog={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Not installed in current runtime");
    expect(container.querySelector("button")?.disabled).toBe(true);
  });
});
