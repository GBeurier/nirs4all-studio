/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { PythonEnvInspectionCard } from "../PythonEnvInspectionCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderCard() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PythonEnvInspectionCard
        inspection={{
          path: "C:\\Python313",
          pythonPath: "C:\\Python313\\python.exe",
          pythonVersion: "3.13.9",
          envKind: "system",
          writable: true,
          hasNirs4all: false,
          hasCorePackages: false,
          missingCorePackages: ["nirs4all", "fastapi"],
          missingOptionalPackages: ["torch"],
          profileAlignmentGuess: {
            id: "cpu",
            label: "CPU",
            missingCount: 2,
          },
        }}
        busy
        busyTitle="Installing core packages"
        busyDetail="Preparing the selected environment for the backend."
        busyProgress={48}
        onBack={() => undefined}
        onUseAsIs={() => undefined}
        onInstallCoreAndSwitch={() => undefined}
      />,
    );
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PythonEnvInspectionCard", () => {
  it("shows a visible busy state while core packages are being installed", async () => {
    const view = await renderCard();

    expect(view.container.textContent).toContain("Installing core packages");
    expect(view.container.textContent).toContain("Preparing the selected environment for the backend.");
    expect(view.container.textContent).toContain("Installing core packages...");

    await view.unmount();
  });
});
