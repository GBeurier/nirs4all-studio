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
    currentVersion: "1.0.0",
    hasUpdate: true,
    isPrerelease: false,
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
  it("shows the newer version and one action that opens the installer dialog", async () => {
    const onOpenDialog = vi.fn();
    const container = await render(
      <WebappUpdateRow row={createWebappRow({ isPrerelease: true })} onOpenDialog={onOpenDialog} />,
    );

    expect(container.textContent).toContain("nirs4all Studio");
    expect(container.textContent).toContain("Current: 1.0.0 → 1.1.0");
    expect(container.textContent).toContain("pre-release");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector("button")?.textContent).toContain("Get installer");

    await click(container.querySelector("button"));

    expect(onOpenDialog).toHaveBeenCalledTimes(1);
  });

  it("shows only the installed version when Studio is up to date", async () => {
    const container = await render(
      <WebappUpdateRow row={createWebappRow({ hasUpdate: false, targetVersion: "1.0.0" })} onOpenDialog={vi.fn()} />,
    );

    expect(container.textContent).toContain("Current: 1.0.0");
    expect(container.textContent).not.toContain("→");
    expect(container.textContent).toContain("Up to date");
    expect(container.querySelector("button")).toBeNull();
  });
});
