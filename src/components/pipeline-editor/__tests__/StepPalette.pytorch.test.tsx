/**
 * @vitest-environment jsdom
 *
 * The step palette against the real node registry: which neural-network
 * models it lists per Python environment, and what picking one does.
 */

import { act, type HTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deepLearningAvailable: false }));

vi.mock("@/hooks/useBackendCapabilities", () => ({
  useDeepLearningAvailable: () => mocks.deepLearningAvailable,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), isDragging: false }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ id }: { id?: string }) => <input id={id} type="checkbox" readOnly />,
}));

vi.mock("@/lib/motion", () => ({
  motion: {
    div: ({ children, initial: _initial, animate: _animate, whileHover: _hover,
      whileTap: _tap, transition: _transition, ...props }: HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

import "@/lib/i18n";
import {
  envReport,
  envState,
  installPythonEnvApi,
  mockPythonEnvApi,
  recommendedPackage,
  type PythonEnvApiMock,
} from "@/components/python-env/__tests__/fixtures";
import { PythonEnvProvider } from "@/context/PythonEnvContext";
import { PyTorchInstallPromptProvider } from "@/context/PyTorchInstallPromptContext";
import { usePyTorchGate } from "@/context/usePyTorchInstallPrompt";
import { pyTorchNeedOfOperator } from "@/lib/pytorchRequirement";
import type { PythonEnvState } from "@/types/pythonEnvironment";
import { NodeRegistryProvider } from "../contexts/NodeRegistryContext";
import { StepPalette } from "../StepPalette";
import type { StepOption, StepType } from "../types";
import { PipelineDndContext } from "../usePipelineDnd";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PALETTE_HINT = "PyTorch is not installed. Studio offers to install it when you add this model.";
const dnd = { activeData: null, dropIndicator: null, isDragging: false, activeId: null };
const torchInstalled = envState({
  selected: envReport({ recommended: [recommendedPackage({ name: "torch", installedVersion: "2.6.0", status: "ok" })] }),
});

/** The palette wired the way the pipeline editor page wires it. */
function Editor({ onAddStep }: { onAddStep: (type: StepType, option: StepOption) => void }) {
  const addStep = usePyTorchGate(onAddStep, (_type, option) => pyTorchNeedOfOperator(option));
  return <StepPalette onAddStep={addStep} />;
}

describe("StepPalette and PyTorch models", () => {
  let root: Root;
  let container: HTMLDivElement;
  let restoreApi: (() => void) | undefined;
  const onAddStep = vi.fn<(type: StepType, option: StepOption) => void>();

  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    mocks.deepLearningAvailable = false;
    vi.spyOn(console, "log").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    restoreApi?.();
    restoreApi = undefined;
    vi.restoreAllMocks();
    onAddStep.mockReset();
    localStorage.clear();
  });

  /** Renders the palette with every model listed; `state` null is the browser. */
  async function openModels(state: PythonEnvState | null): Promise<PythonEnvApiMock | null> {
    const api = state ? mockPythonEnvApi(state) : null;
    if (api) restoreApi = installPythonEnvApi(api);
    await act(async () => root.render(
      <PythonEnvProvider>
        <PyTorchInstallPromptProvider>
          <NodeRegistryProvider>
            <PipelineDndContext.Provider value={dnd}>
              <Editor onAddStep={onAddStep} />
            </PipelineDndContext.Provider>
          </NodeRegistryProvider>
        </PyTorchInstallPromptProvider>
      </PythonEnvProvider>,
    ));
    const buttons = () => [...container.querySelectorAll("button")];
    await act(async () => buttons().find((button) => button.textContent === "All")!.click());
    await act(async () => buttons().find((button) => button.textContent?.includes("Regression Models"))!.click());
    return api;
  }

  /** The palette row of a model, or undefined when the palette does not list it. */
  const row = (name: string) => [...container.querySelectorAll("p")]
    .find((label) => label.textContent === name)?.closest<HTMLElement>("[aria-disabled]");
  const pick = (name: string) => act(async () => {
    row(name)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  const dialog = () => document.body.querySelector('[role="dialog"]');
  const dialogButton = (label: string) => [...dialog()!.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === label)!;

  it("lists PyTorch models with a quiet hint in a writable desktop environment without PyTorch", async () => {
    await openModels(envState());

    for (const name of ["NICoN", "CNN1D", "Transformer"]) {
      expect(row(name)).toBeDefined();
      expect(row(name)!.querySelector(`[aria-label="${PALETTE_HINT}"]`)).not.toBeNull();
    }
    // Models of a framework Studio does not offer here stay hidden, as before.
    expect(row("TabPFN")).toBeUndefined();
    expect(row("PLSRegression")!.querySelector(`[aria-label="${PALETTE_HINT}"]`)).toBeNull();
  });

  it.each<[string, PythonEnvState | null]>([
    ["a writable environment without PyTorch", envState()],
    ["a read-only environment", envState({ selected: envReport({ writable: false }) })],
    ["the browser", null],
  ])("lists the scikit-learn neural network and adds it at once in %s", async (_label, state) => {
    await openModels(state);

    // Flagged deep learning, but it declares no package: it runs without PyTorch.
    expect(row("MLPRegressor")!.querySelector(`[aria-label="${PALETTE_HINT}"]`)).toBeNull();
    await pick("MLPRegressor");
    expect(dialog()).toBeNull();
    expect(onAddStep).toHaveBeenCalledWith("model", expect.objectContaining({ name: "MLPRegressor" }));
  });

  it.each<[string, PythonEnvState | null]>([
    ["a read-only environment", envState({ selected: envReport({ writable: false }) })],
    ["the browser", null],
  ])("keeps PyTorch models hidden for %s", async (_label, state) => {
    await openModels(state);

    expect(row("NICoN")).toBeUndefined();
    expect(row("PLSRegression")).toBeDefined();
  });

  it("lists PyTorch models without the hint once PyTorch is installed", async () => {
    mocks.deepLearningAvailable = true;
    await openModels(torchInstalled);

    expect(row("NICoN")).toBeDefined();
    expect(container.querySelector(`[aria-label="${PALETTE_HINT}"]`)).toBeNull();
    await pick("NICoN");
    expect(dialog()).toBeNull();
    expect(onAddStep).toHaveBeenCalledTimes(1);
  });

  it("adds a model that does not need PyTorch at once", async () => {
    await openModels(envState());
    await pick("PLSRegression");

    expect(dialog()).toBeNull();
    expect(onAddStep).toHaveBeenCalledWith("model", expect.objectContaining({ name: "PLSRegression" }));
  });

  it("asks before adding a PyTorch model and adds it only after a successful installation", async () => {
    const api = await openModels(envState());
    api!.installPackages.mockResolvedValue({ success: true, hostRestarted: true, state: torchInstalled });

    await pick("NICoN");
    expect(dialog()!.textContent).toContain("NICoN is a neural-network model.");
    expect(onAddStep).not.toHaveBeenCalled();
    expect(api!.installPackages).not.toHaveBeenCalled();

    await act(async () => dialogButton("Install PyTorch").click());
    expect(api!.installPackages).toHaveBeenCalledWith(["torch"]);
    expect(onAddStep).toHaveBeenCalledTimes(1);
    expect(onAddStep).toHaveBeenCalledWith("model", expect.objectContaining({
      name: "NICoN",
      classPath: "nirs4all.operators.models.pytorch.nicon.nicon",
    }));
    expect(dialog()).toBeNull();
  });

  it("does not add the model when the user answers \"Not now\"", async () => {
    const api = await openModels(envState());

    await pick("Transformer");
    await act(async () => dialogButton("Not now").click());

    expect(dialog()).toBeNull();
    expect(onAddStep).not.toHaveBeenCalled();
    expect(api!.installPackages).not.toHaveBeenCalled();
    expect(row("Transformer")).toBeDefined();
  });
});
