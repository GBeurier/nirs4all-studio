/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "i18next";

import "@/lib/i18n";

import { WebappUpdateRow } from "../UpdatesSectionRows";
import type { WebappUpdateRowState } from "../UpdatesSectionLogic";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

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
