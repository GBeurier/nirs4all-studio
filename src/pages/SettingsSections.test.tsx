/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedSettingsTab } from "./SettingsSections";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/settings/WorkspaceStats", () => ({ WorkspaceStats: () => null }));
vi.mock("@/components/settings/DataLoadingDefaultsForm", () => ({ DataLoadingDefaultsForm: () => null }));
vi.mock("@/components/settings/KeyboardShortcuts", () => ({ KeyboardShortcuts: () => null }));
vi.mock("@/components/settings/CreateWorkspaceDialog", () => ({ CreateWorkspaceDialog: () => null }));
vi.mock("@/components/settings/SystemInfo", () => ({ SystemInfo: () => null }));
vi.mock("@/components/settings/BackendStatus", () => ({ BackendStatus: () => null }));
vi.mock("@/components/settings/ErrorLogViewer", () => ({ ErrorLogViewer: () => null }));
vi.mock("@/components/settings/LanguageSelector", () => ({ LanguageSelector: () => null }));
vi.mock("@/components/settings/RuntimeBackendStatusCard", () => ({ RuntimeBackendStatusCard: () => null }));
vi.mock("@/components/settings/N4AWorkspaceSelector", () => ({ N4AWorkspaceSelector: () => null }));
vi.mock("@/components/settings/N4AWorkspaceList", () => ({ N4AWorkspaceList: () => null }));
vi.mock("@/components/settings/WorkspaceDiscoveryPanel", () => ({ WorkspaceDiscoveryPanel: () => null }));
vi.mock("@/components/settings/UpdatesSection", () => ({ UpdatesSection: () => null }));
vi.mock("@/components/settings/DependenciesManager", () => ({ DependenciesManager: () => null }));
vi.mock("@/components/settings/ConfigPathSettings", () => ({ ConfigPathSettings: () => null }));
vi.mock("@/components/settings/ConfigAlignment", () => ({ ConfigAlignment: () => null }));
vi.mock("@/components/settings/PythonEnvPicker", () => ({ PythonEnvPicker: () => null }));
vi.mock("@/components/settings/StorageHealthWidget", () => ({ StorageHealthWidget: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Advanced settings developer mode", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function mount(isLoadingDevMode: boolean) {
    await act(async () => root.render(
      <AdvancedSettingsTab
        isDeveloperMode={false}
        handleDeveloperModeChange={onChange}
        isLoadingDevMode={isLoadingDevMode}
        backendUrl="http://127.0.0.1:8000"
        isRestarting={false}
        handleRestartBackend={() => {}}
        handleClearLocalStorage={() => {}}
        handleResetToDefaults={() => {}}
      />
    ));
    return container.querySelector<HTMLButtonElement>('button[role="switch"]')!;
  }

  it("lets a fresh profile enable developer mode before selecting any workspace", async () => {
    const toggle = await mount(false);
    expect(toggle).not.toBeNull();
    expect(toggle.disabled).toBe(false);
    await act(async () => toggle.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("waits for the saved app preference before accepting changes", async () => {
    const toggle = await mount(true);
    expect(toggle.disabled).toBe(true);
    await act(async () => toggle.click());
    expect(onChange).not.toHaveBeenCalled();
  });
});
