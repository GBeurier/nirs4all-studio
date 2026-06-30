import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TABS,
  getSettingsTabFromSearchParams,
  isSettingsTabId,
  resolveSettingsTabValue,
} from "./settingsNavigation";

describe("settingsNavigation", () => {
  it("keeps the tab order used by Settings", () => {
    expect(SETTINGS_TABS.map((tab) => tab.value)).toEqual([
      "general",
      "workspaces",
      "data",
      "advanced",
    ]);
  });

  it("identifies supported tab ids", () => {
    expect(isSettingsTabId("general")).toBe(true);
    expect(isSettingsTabId("workspaces")).toBe(true);
    expect(isSettingsTabId("missing")).toBe(false);
    expect(isSettingsTabId(null)).toBe(false);
  });

  it("resolves unknown tab values to the general tab", () => {
    expect(resolveSettingsTabValue(null)).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTabValue("unknown")).toBe(DEFAULT_SETTINGS_TAB);
  });

  it("reads the active tab from route search params", () => {
    expect(getSettingsTabFromSearchParams(new URLSearchParams("tab=data"))).toBe("data");
    expect(getSettingsTabFromSearchParams(new URLSearchParams("tab=unknown"))).toBe(DEFAULT_SETTINGS_TAB);
  });
});
