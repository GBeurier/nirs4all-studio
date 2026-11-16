/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMocks }));

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
import {
  usePyTorchGate,
  usePyTorchInstallPrompt,
  type PyTorchInstallPromptValue,
} from "@/context/usePyTorchInstallPrompt";
import type { PyTorchNeed } from "@/lib/pytorchRequirement";
import type { PythonEnvActionResult, PythonEnvState } from "@/types/pythonEnvironment";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NICON: PyTorchNeed = { kind: "model", name: "NICoN" };
const torchInstalled = envState({
  selected: envReport({ recommended: [recommendedPackage({ name: "torch", installedVersion: "2.6.0", status: "ok" })] }),
});

describe("PyTorch installation prompt", () => {
  let root: Root;
  let container: HTMLDivElement;
  let restoreApi: (() => void) | undefined;
  let prompt: PyTorchInstallPromptValue;

  function Probe() {
    prompt = usePyTorchInstallPrompt();
    return null;
  }

  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    restoreApi?.();
    restoreApi = undefined;
    vi.clearAllMocks();
  });

  /** Mounts the application providers; `state` null is the browser, without a desktop API. */
  async function mount(state: PythonEnvState | null, children = <Probe />): Promise<PythonEnvApiMock | null> {
    const api = state ? mockPythonEnvApi(state) : null;
    if (api) restoreApi = installPythonEnvApi(api);
    await act(async () => root.render(
      <PythonEnvProvider>
        <PyTorchInstallPromptProvider>{children}</PyTorchInstallPromptProvider>
      </PythonEnvProvider>,
    ));
    return api;
  }

  /** An installation that stays in progress until the returned function settles it. */
  function holdInstallation(api: PythonEnvApiMock) {
    let settle!: (result: PythonEnvActionResult) => void;
    api.installPackages.mockImplementation(() => new Promise<PythonEnvActionResult>((resolve) => { settle = resolve; }));
    return (result: PythonEnvActionResult) => act(async () => settle(result));
  }

  const dialog = () => document.body.querySelector('[role="dialog"]');
  const button = (label: string) => [...document.body.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  const click = (label: string) => act(async () => button(label)!.click());
  const ask = (proceed: () => void, need: PyTorchNeed = NICON) => act(async () => prompt.request(need, proceed));
  const succeeded: PythonEnvActionResult = { success: true, hostRestarted: true, state: torchInstalled };
  const refused = (message: string): PythonEnvActionResult => ({ success: false, message, hostRestarted: false, state: envState() });

  it.each<[string, PythonEnvState | null, boolean]>([
    ["a writable desktop environment without PyTorch", envState(), true],
    ["a read-only environment", envState({ selected: envReport({ writable: false }) }), false],
    ["an environment that already has PyTorch", torchInstalled, false],
    ["an environment busy with another action", envState({ phase: "busy" }), false],
    ["an environment that needs attention", envState({ phase: "needs_attention" }), false],
    ["a Python version PyTorch does not support", envState({
      selected: envReport({ recommended: [recommendedPackage({ name: "torch", installedVersion: null, status: "unsupported_python" })] }),
    }), false],
    ["the browser", null, false],
  ])("offers the installation for %s: %s", async (_label, state, expected) => {
    await mount(state);
    expect(prompt.canInstall).toBe(expected);
  });

  it("explains the need, the environment and the cost before anything is installed", async () => {
    const api = await mount(envState());
    const proceed = vi.fn();
    await ask(proceed);

    const text = dialog()!.textContent;
    expect(text).toContain("Install PyTorch?");
    expect(text).toContain("NICoN is a neural-network model. It needs PyTorch, which is not installed in the current Python environment.");
    expect(text).toContain("/home/ada/venvs/nirs");
    expect(text).toContain("it can exceed 2 GB with GPU support");
    expect(text).toContain("can take several minutes");
    expect(text).toContain("The analysis engine restarts when it finishes.");
    expect(button("Install PyTorch")).toBeDefined();
    expect(button("Not now")).toBeDefined();
    expect(api!.installPackages).not.toHaveBeenCalled();
    expect(proceed).not.toHaveBeenCalled();
  });

  it("words the request for an experiment launch", async () => {
    await mount(envState());
    await ask(vi.fn(), { kind: "experiment" });
    expect(dialog()!.textContent).toContain("This experiment uses neural-network models.");
    expect(dialog()!.textContent).toContain("The experiment starts once PyTorch is installed.");
  });

  it("closes on \"Not now\" without installing or proceeding", async () => {
    const api = await mount(envState());
    const proceed = vi.fn();
    await ask(proceed);
    await click("Not now");

    expect(dialog()).toBeNull();
    expect(api!.installPackages).not.toHaveBeenCalled();
    expect(proceed).not.toHaveBeenCalled();
  });

  it("opens once for a selection delivered twice", async () => {
    const api = await mount(envState());
    const proceed = vi.fn();
    await act(async () => {
      prompt.request(NICON, proceed);
      prompt.request(NICON, proceed);
    });
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    await click("Install PyTorch");
    expect(api!.installPackages).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("installs PyTorch once, shows the progress, then proceeds", async () => {
    const api = await mount(envState());
    const finish = holdInstallation(api!);
    const restarted = vi.fn();
    window.addEventListener("backend-restarted", restarted);
    const proceed = vi.fn();
    await ask(proceed);

    await act(async () => {
      button("Install PyTorch")!.click();
      button("Install PyTorch")!.click();
    });
    expect(api!.installPackages).toHaveBeenCalledTimes(1);
    expect(api!.installPackages).toHaveBeenCalledWith(["torch"]);
    expect(button("Install PyTorch")).toBeUndefined();

    await act(async () => api!.emit(envState({
      phase: "busy",
      activity: { kind: "installing", percent: 42, detail: "Downloading torch (812 MB)" },
    })));
    expect(dialog()!.textContent).toContain("Installing PyTorch");
    expect(dialog()!.textContent).toContain("42%");
    expect(dialog()!.textContent).toContain("Downloading torch (812 MB)");
    // The environment stays the installation target while it is busy with this installation.
    expect(prompt.canInstall).toBe(true);
    expect(proceed).not.toHaveBeenCalled();

    await finish(succeeded);
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(prompt.canInstall).toBe(false);
    expect(restarted).toHaveBeenCalledTimes(1);
    expect(toastMocks.success).toHaveBeenCalledWith("PyTorch is installed.");
    window.removeEventListener("backend-restarted", restarted);
  });

  it("shows why the installation failed and retries on request", async () => {
    const api = await mount(envState());
    api!.installPackages.mockResolvedValueOnce(refused("A run is in progress. Wait for it to finish, then try again."));
    const proceed = vi.fn();
    await ask(proceed);
    await click("Install PyTorch");

    expect(dialog()!.textContent).toContain("PyTorch could not be installed");
    expect(dialog()!.textContent).toContain("A run is in progress. Wait for it to finish, then try again.");
    expect(proceed).not.toHaveBeenCalled();

    api!.installPackages.mockResolvedValueOnce(succeeded);
    await click("Retry");
    expect(api!.installPackages).toHaveBeenCalledTimes(2);
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("reports an installation that could not be started and drops the request on \"Not now\"", async () => {
    const api = await mount(envState());
    api!.installPackages.mockRejectedValueOnce(new Error("Network is unreachable"));
    const proceed = vi.fn();
    await ask(proceed);
    await click("Install PyTorch");
    expect(dialog()!.textContent).toContain("Network is unreachable");

    await click("Not now");
    expect(dialog()).toBeNull();
    expect(proceed).not.toHaveBeenCalled();

    // A later request starts from the question again.
    await ask(vi.fn());
    expect(dialog()!.textContent).not.toContain("Network is unreachable");
    expect(button("Install PyTorch")).toBeDefined();
  });

  it("keeps installing in the background and proceeds when it succeeds", async () => {
    const api = await mount(envState());
    const finish = holdInstallation(api!);
    const first = vi.fn();
    const second = vi.fn();
    await ask(first);
    await click("Install PyTorch");
    await click("Continue in the background");
    expect(dialog()).toBeNull();

    // Another model picked meanwhile joins the running installation instead of starting one.
    await ask(second, { kind: "model", name: "Transformer" });
    expect(dialog()!.textContent).toContain("Installing PyTorch");
    expect(dialog()!.textContent).toContain("Transformer is a neural-network model.");
    expect(button("Install PyTorch")).toBeUndefined();
    await click("Continue in the background");

    await finish(succeeded);
    expect(api!.installPackages).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("proceeds once when the same request is repeated during the installation", async () => {
    const api = await mount(envState());
    const finish = holdInstallation(api!);
    const firstLaunch = vi.fn();
    const secondLaunch = vi.fn();
    await ask(firstLaunch, { kind: "experiment" });
    await click("Install PyTorch");
    await click("Continue in the background");
    await ask(secondLaunch, { kind: "experiment" });

    await finish(succeeded);
    expect(api!.installPackages).toHaveBeenCalledTimes(1);
    expect(firstLaunch).not.toHaveBeenCalled();
    expect(secondLaunch).toHaveBeenCalledTimes(1);
  });

  it("reports a background failure with a notification and does not proceed", async () => {
    const api = await mount(envState());
    const finish = holdInstallation(api!);
    const proceed = vi.fn();
    await ask(proceed);
    await click("Install PyTorch");
    await click("Continue in the background");

    await finish(refused("No space left on device"));
    expect(proceed).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(toastMocks.error).toHaveBeenCalledWith("PyTorch could not be installed", { description: "No space left on device" });
  });

  describe("usePyTorchGate", () => {
    let gated: (name: string) => string | undefined;

    function Gated({ action }: { action: (name: string) => string }) {
      gated = usePyTorchGate(action, (name) => (name === "NICoN" ? { kind: "model", name } : null));
      return null;
    }

    it("runs an action that does not need PyTorch at once", async () => {
      const action = vi.fn((name: string) => `added ${name}`);
      await mount(envState(), <Gated action={action} />);
      expect(gated("PLSRegression")).toBe("added PLSRegression");
      expect(dialog()).toBeNull();
    });

    it("does not ask where Studio cannot install PyTorch", async () => {
      const action = vi.fn((name: string) => `added ${name}`);
      await mount(envState({ selected: envReport({ writable: false }) }), <Gated action={action} />);
      expect(gated("NICoN")).toBe("added NICoN");
      expect(dialog()).toBeNull();
    });

    it("runs the current action with the original arguments after the installation", async () => {
      const stale = vi.fn((name: string) => `stale ${name}`);
      const current = vi.fn((name: string) => `current ${name}`);
      const api = await mount(envState(), <Gated action={stale} />);
      const finish = holdInstallation(api!);

      await act(async () => { gated("NICoN"); });
      expect(dialog()).not.toBeNull();
      await click("Install PyTorch");
      // The caller re-rendered with a newer action while PyTorch was installing.
      await act(async () => root.render(
        <PythonEnvProvider>
          <PyTorchInstallPromptProvider><Gated action={current} /></PyTorchInstallPromptProvider>
        </PythonEnvProvider>,
      ));
      await finish(succeeded);

      expect(stale).not.toHaveBeenCalled();
      expect(current).toHaveBeenCalledWith("NICoN");
    });

    it("drops the action when its caller is gone before the installation ends", async () => {
      const action = vi.fn((name: string) => `added ${name}`);
      const api = await mount(envState(), <Gated action={action} />);
      const finish = holdInstallation(api!);

      await act(async () => { gated("NICoN"); });
      await click("Install PyTorch");
      await click("Continue in the background");
      await act(async () => root.render(
        <PythonEnvProvider>
          <PyTorchInstallPromptProvider><Probe /></PyTorchInstallPromptProvider>
        </PythonEnvProvider>,
      ));
      await finish(succeeded);

      expect(action).not.toHaveBeenCalled();
      expect(toastMocks.success).toHaveBeenCalledWith("PyTorch is installed.");
    });
  });
});
