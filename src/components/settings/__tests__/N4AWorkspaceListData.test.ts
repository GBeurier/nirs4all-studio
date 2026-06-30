import { describe, expect, it } from "vitest";

import {
  WORKSPACE_ACTION_COPY,
  formatCountLabel,
  getDiscoveredCounts,
  getLastScannedLabel,
  getLinkedWorkspaceCountLabel,
  getScanSuccessMessage,
  getWorkspaceDiscoveredCountItems,
  getWorkspaceItemState,
} from "../N4AWorkspaceListData";

describe("N4AWorkspaceListData", () => {
  it("fills missing discovered counts with zero defaults", () => {
    expect(getDiscoveredCounts()).toEqual({
      runs_count: 0,
      datasets_count: 0,
      exports_count: 0,
      templates_count: 0,
    });

    expect(getDiscoveredCounts({ runs_count: 2, exports_count: 1 })).toEqual({
      runs_count: 2,
      datasets_count: 0,
      exports_count: 1,
      templates_count: 0,
    });
  });

  it("formats singular and plural count labels", () => {
    expect(formatCountLabel(0, "run")).toBe("0 runs");
    expect(formatCountLabel(1, "run")).toBe("1 run");
    expect(formatCountLabel(2, "run")).toBe("2 runs");
    expect(formatCountLabel(1, "analysis", "analyses")).toBe("1 analysis");
    expect(formatCountLabel(2, "analysis", "analyses")).toBe("2 analyses");
  });

  it("builds discovered count display items in list order", () => {
    expect(
      getWorkspaceDiscoveredCountItems({
        runs_count: 1,
        exports_count: 2,
        datasets_count: 1,
        templates_count: 0,
      }),
    ).toEqual([
      { key: "runs", count: 1, label: "1 run" },
      { key: "exports", count: 2, label: "2 exports" },
      { key: "datasets", count: 1, label: "1 dataset" },
      { key: "templates", count: 0, label: "0 templates" },
    ]);
  });

  it("formats linked workspace and scan success messages", () => {
    expect(getLinkedWorkspaceCountLabel(1)).toBe("1 workspace linked");
    expect(getLinkedWorkspaceCountLabel(3)).toBe("3 workspaces linked");
    expect(getScanSuccessMessage({ runs_count: 1, exports_count: 2 })).toBe(
      "Scanned: 1 run, 2 exports",
    );
    expect(getScanSuccessMessage()).toBe("Scanned: 0 runs, 0 exports");
  });

  it("returns a scanned label only when a scan timestamp exists", () => {
    const formatter = (value: string) => `relative:${value}`;

    expect(getLastScannedLabel(null, formatter)).toBeNull();
    expect(getLastScannedLabel("2026-06-30T08:00:00Z", formatter)).toBe(
      "Scanned relative:2026-06-30T08:00:00Z",
    );
  });

  it("describes active and inactive workspace item state", () => {
    const active = getWorkspaceItemState({ is_active: true });
    const inactive = getWorkspaceItemState({ is_active: false });

    expect(active.containerClassName).toContain("border-primary");
    expect(active.activeBadge).toEqual({
      label: "Active",
      variant: "default",
      className: "text-xs",
    });
    expect(inactive.containerClassName).toContain("hover:bg-muted/50");
    expect(inactive.activeBadge).toBeNull();
  });

  it("keeps action labels and tooltips outside JSX", () => {
    expect(WORKSPACE_ACTION_COPY.activate).toEqual({
      label: "Activate",
      tooltip: "Set as active workspace",
    });
    expect(WORKSPACE_ACTION_COPY.scan.tooltip).toBe("Rescan workspace");
    expect(WORKSPACE_ACTION_COPY.unlink.confirmLabel).toBe("Unlink");
  });
});
