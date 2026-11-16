/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/i18n";
import { PythonEnvProvider } from "@/context/PythonEnvContext";
import { PythonEnvironmentPage } from "../PythonEnvironmentPage";
import {
  envReport,
  envState,
  installPythonEnvApi,
  mockPythonEnvApi,
  newEnvPlan,
  requiredPackage,
  unconfiguredState,
  type PythonEnvApiMock,
} from "./fixtures";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), systemInfo: vi.fn(), resetBackendUrl: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/api/system", () => ({ getSystemInfo: mocks.systemInfo }));
vi.mock("@/api/transport", () => ({ resetBackendUrl: mocks.resetBackendUrl }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const current = envReport();
const other = envReport({
  pythonPath: "/opt/conda/envs/lab/bin/python",
  envRoot: "/opt/conda/envs/lab",
  kind: "conda",
  pythonVersion: "3.12.4",
  required: [requiredPackage({ installedVersion: null, status: "missing" })],
});

let root: Root;
let container: HTMLDivElement;
let restoreApi: (() => void) | undefined;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  restoreApi?.();
  restoreApi = undefined;
});

async function mount(api: PythonEnvApiMock | null, context: "setup" | "settings" = "settings") {
  if (api) restoreApi = installPythonEnvApi(api);
  await act(async () => root.render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PythonEnvProvider>
        <PythonEnvironmentPage context={context} />
      </PythonEnvProvider>
    </QueryClientProvider>,
  ));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
const button = (label: string) => buttons().find((candidate) => candidate.textContent?.trim() === label);
const radios = () => [...container.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
const radioFor = (text: string) => radios().find((radio) => radio.closest("label")?.textContent?.includes(text))!;
const checkbox = (name: string) => container.querySelector<HTMLButtonElement>(`[id="python-env-package-${name}"]`)!;
const click = async (element: HTMLElement | undefined) => {
  expect(element).toBeDefined();
  await act(async () => element!.click());
};

describe("Python environment page", () => {
  it("lists the environments found with what each lacks, the current one first", async () => {
    const api = mockPythonEnvApi(envState({ selected: current }), [other, current]);
    await mount(api);

    expect(api.detect).toHaveBeenCalledWith(false);
    expect(radios()).toHaveLength(3);
    const first = radios()[0].closest("label")!;
    expect(first.textContent).toContain(current.pythonPath);
    expect(first.textContent).toContain("Current");
    expect(first.textContent).toContain("ready to use");
    expect(radios()[0].getAttribute("aria-checked")).toBe("true");
    const second = radios()[1].closest("label")!;
    expect(second.textContent).toContain("Python 3.12.4");
    expect(second.textContent).toContain("Conda environment");
    expect(second.textContent).toContain("nirs4all will be installed");
    expect(second.textContent).toContain("1 recommended missing");

    await click(button("Refresh"));
    expect(api.detect).toHaveBeenLastCalledWith(true);
  });

  it("installs the ticked packages in the current environment", async () => {
    const api = mockPythonEnvApi(envState({ selected: current }), [current]);
    await mount(api);

    expect(button("Install packages")?.disabled).toBe(true);
    expect(checkbox("xgboost").disabled).toBe(true);
    expect(checkbox("autogluon").disabled).toBe(true);
    expect(container.textContent).toContain("Not available for Python 3.13.1");
    expect(checkbox("shap").getAttribute("aria-checked")).toBe("false");

    await click(checkbox("shap"));
    await click(button("Install 1 package"));

    expect(api.installPackages).toHaveBeenCalledWith(["shap"]);
    expect(mocks.resetBackendUrl).toHaveBeenCalledTimes(1);
  });

  it("switches to another environment with nothing preselected, then with the ticked packages", async () => {
    const api = mockPythonEnvApi(envState({ selected: current }), [current, other]);
    await mount(api);

    await click(radioFor(other.pythonPath));
    expect(checkbox("torch").getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("Installed automatically");
    expect(button("Use this environment")?.disabled).toBe(false);

    await click(checkbox("torch"));
    await click(checkbox("shap"));
    await click(button("Install 2 packages and use this environment"));

    expect(api.apply).toHaveBeenCalledWith({ pythonPath: other.pythonPath, packages: ["torch", "shap"] });
  });

  it("creates a new environment from the plan of the main process, default packages preselected", async () => {
    const api = mockPythonEnvApi(envState({ selected: current }), [current]);
    api.chooseDirectory.mockResolvedValue("/data/envs");
    await mount(api);

    const choice = radioFor("Create a new environment");
    expect(choice.closest("label")?.textContent).toContain("Python 3.11.9");
    await click(choice);
    expect(checkbox("xgboost").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("torch").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("shap").getAttribute("aria-checked")).toBe("false");
    // Unsupported by the planned Python, although it is a default package.
    expect(checkbox("tabpfn").getAttribute("aria-checked")).toBe("false");
    expect(checkbox("tabpfn").disabled).toBe(true);
    expect(container.textContent).toContain("Not available for Python 3.11.9");
    // The current environment's own gaps do not leak into the new one.
    expect(container.textContent).not.toContain("Not available for Python 3.13.1");

    await click(checkbox("xgboost"));
    await click(button("Choose folder…"));
    expect(container.textContent).toContain("/data/envs");
    await click(button("Create environment"));

    expect(api.create).toHaveBeenCalledWith({ directory: "/data/envs", packages: ["torch"] });
  });

  it("creates with the default packages when no Python is found on a first launch", async () => {
    const api = mockPythonEnvApi(unconfiguredState(), []);
    await mount(api, "setup");

    expect(container.textContent).toContain("No Python environment was found on this computer.");
    expect(radioFor("Create a new environment").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("torch").getAttribute("aria-checked")).toBe("true");
    await click(button("Create environment"));
    expect(api.create).toHaveBeenCalledWith({ packages: ["xgboost", "torch"] });
  });

  it("does not create before the main process has described the new environment", async () => {
    const api = mockPythonEnvApi(unconfiguredState(), []);
    api.describeNewEnvironment.mockRejectedValue(new Error("catalogue unreadable"));
    await mount(api, "setup");

    expect(container.textContent).toContain("catalogue unreadable");
    expect(button("Create environment")?.disabled).toBe(true);

    api.describeNewEnvironment.mockResolvedValue(newEnvPlan());
    await click(button("Refresh"));
    expect(button("Create environment")?.disabled).toBe(false);
  });

  it("keeps the ticks of an environment when another answer arrives", async () => {
    const api = mockPythonEnvApi(envState({ selected: current }), [current, other]);
    await mount(api);

    await click(radioFor(other.pythonPath));
    await click(checkbox("torch"));
    await act(async () => api.emit(envState({ selected: current })));
    expect(checkbox("torch").getAttribute("aria-checked")).toBe("true");

    await click(radioFor("Create a new environment"));
    await click(radioFor(other.pythonPath));
    expect(checkbox("torch").getAttribute("aria-checked")).toBe("false");
  });

  it("does not let a read-only environment without nirs4all be applied", async () => {
    const readOnly = envReport({ ...other, writable: false });
    const api = mockPythonEnvApi(envState({ selected: current }), [current, readOnly]);
    await mount(api);

    await click(radioFor(readOnly.pythonPath));
    expect(button("Use this environment")?.disabled).toBe(true);
    expect(checkbox("torch").disabled).toBe(true);
    expect(container.textContent).toContain("This environment is read-only: Studio cannot install or update packages in it.");
    expect(container.textContent).toContain("so Studio cannot use it");
    expect(api.apply).not.toHaveBeenCalled();
  });

  it("applies a usable read-only environment but keeps its packages locked", async () => {
    const readOnly = envReport({ pythonPath: "/usr/bin/python3", kind: "system", writable: false });
    const api = mockPythonEnvApi(envState({ selected: current }), [current, readOnly]);
    await mount(api);

    await click(radioFor("/usr/bin/python3"));
    expect(checkbox("shap").disabled).toBe(true);
    await click(button("Use this environment"));
    expect(api.apply).toHaveBeenCalledWith({ pythonPath: "/usr/bin/python3", packages: [] });
  });

  it("shows why a change failed and keeps the choice", async () => {
    const state = envState({ selected: current });
    const api = mockPythonEnvApi(state, [current, other]);
    api.apply.mockResolvedValue({ success: false, message: "uv could not download nirs4all 1.4.16", state });
    await mount(api);

    await click(radioFor(other.pythonPath));
    await click(button("Use this environment"));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("uv could not download nirs4all 1.4.16");
    expect(radioFor(other.pythonPath).getAttribute("aria-checked")).toBe("true");
    expect(mocks.resetBackendUrl).not.toHaveBeenCalled();
    expect(container.querySelector("details")?.open).toBe(true);
  });

  it("follows the main process while it works", async () => {
    const api = mockPythonEnvApi(envState({ selected: current }), [current]);
    await mount(api);

    await act(async () => api.emit(envState({
      selected: current,
      phase: "busy",
      activity: { kind: "installing", percent: 40, detail: "Downloading torch 2.6.0" },
    })));

    expect(container.textContent).toContain("Installing packages…");
    expect(container.textContent).toContain("40%");
    expect(container.textContent).toContain("Downloading torch 2.6.0");
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(checkbox("shap").disabled).toBe(true);
    expect(radios().every((radio) => radio.disabled)).toBe(true);
  });

  it("explains a problem and retries", async () => {
    const api = mockPythonEnvApi(envState({
      selected: current,
      phase: "needs_attention",
      problem: { code: "required_update_failed", message: "No network connection." },
    }), [current]);
    await mount(api);

    expect(container.textContent).toContain("The required packages could not be installed");
    expect(container.textContent).toContain("No network connection.");
    await click(button("Retry"));
    expect(api.retry).toHaveBeenCalledTimes(1);
  });

  it("adds an interpreter chosen by the user, or says why it cannot be used", async () => {
    const api = mockPythonEnvApi(envState({ selected: current }), [current]);
    api.browse.mockResolvedValue("/custom/python");
    await mount(api);

    await click(button("Browse for Python…"));
    expect(container.textContent).toContain("Not a Python interpreter");

    api.inspect.mockResolvedValue({ report: envReport({ ...other, pythonPath: "/custom/python" }) });
    await click(button("Browse for Python…"));
    expect(api.inspect).toHaveBeenLastCalledWith("/custom/python");
    expect(radioFor("/custom/python").getAttribute("aria-checked")).toBe("true");
    expect(button("Use this environment")?.disabled).toBe(false);
  });

  it("opens Studio from setup once ready, or continues without Python", async () => {
    const ready = mockPythonEnvApi(envState({ selected: current }), [current]);
    await mount(ready, "setup");
    expect(container.textContent).toContain("Set up Python");
    expect(button("Continue without Python")).toBeUndefined();
    await click(buttons().filter((candidate) => candidate.textContent === "Open Studio").at(-1));
    expect(mocks.navigate).toHaveBeenCalledWith("/datasets", { replace: true });
  });

  it("lets the user leave setup without an environment", async () => {
    await mount(mockPythonEnvApi(unconfiguredState(), [other]), "setup");
    expect(button("Open Studio")).toBeUndefined();
    expect(button("Choose an environment")?.disabled).toBe(true);
    await click(button("Continue without Python"));
    expect(mocks.navigate).toHaveBeenCalledWith("/datasets", { replace: true });
  });
});

describe("Python tab outside the desktop application", () => {
  it("shows a read-only summary managed by the deployment", async () => {
    mocks.systemInfo.mockResolvedValue({
      python: { version: "3.11.9 (main, Apr 2 2024)", platform: "linux", executable: "/opt/venv/bin/python" },
      system: { os: "Linux", release: "6.8", machine: "x86_64", processor: "" },
      nirs4all_version: "1.4.16",
      packages: {},
    });
    await mount(null);

    expect(container.textContent).toContain("managed by the deployment");
    expect(container.textContent).toContain("/opt/venv/bin/python");
    expect(container.textContent).toContain("3.11.9");
    expect(container.textContent).not.toContain("(main");
    expect(container.textContent).toContain("1.4.16");
    expect(radios()).toHaveLength(0);
    expect(buttons()).toHaveLength(0);
  });
});
