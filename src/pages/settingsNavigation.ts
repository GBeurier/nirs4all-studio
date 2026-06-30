export const DEFAULT_SETTINGS_TAB = "general";

export const SETTINGS_TABS = [
  { value: "general", labelKey: "settings.tabs.general" },
  { value: "workspaces", label: "Workspaces" },
  { value: "data", labelKey: "settings.tabs.data" },
  { value: "advanced", labelKey: "settings.tabs.advanced" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["value"];

export function isSettingsTabId(value: string | null): value is SettingsTabId {
  return SETTINGS_TABS.some((tab) => tab.value === value);
}

export function resolveSettingsTabValue(value: string | null): SettingsTabId {
  return isSettingsTabId(value) ? value : DEFAULT_SETTINGS_TAB;
}

export function getSettingsTabFromSearchParams(searchParams: URLSearchParams): SettingsTabId {
  return resolveSettingsTabValue(searchParams.get("tab"));
}
