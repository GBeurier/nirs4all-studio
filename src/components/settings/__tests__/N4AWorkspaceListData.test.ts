/**
 * @vitest-environment jsdom
 */

import i18n from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import "@/lib/i18n";
import {
  getWorkspaceActionCopy,
  getDiscoveredCounts,
  getLastScannedLabel,
  getLinkedWorkspaceCountLabel,
  getScanSuccessMessage,
  getWorkspaceDiscoveredCountItems,
  getWorkspaceItemState,
} from "../N4AWorkspaceListData";

const t = i18n.t.bind(i18n);

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

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
    const labelFor = (runs_count: number) =>
      getWorkspaceDiscoveredCountItems({ runs_count }, t)[0].label;

    expect(labelFor(0)).toBe("0 runs");
    expect(labelFor(1)).toBe("1 run");
    expect(labelFor(2)).toBe("2 runs");
  });

  it("builds discovered count display items in list order", () => {
    expect(
      getWorkspaceDiscoveredCountItems({
        runs_count: 1,
        exports_count: 2,
        datasets_count: 1,
        templates_count: 0,
      }, t),
    ).toEqual([
      { key: "runs", count: 1, label: "1 run" },
      { key: "exports", count: 2, label: "2 exports" },
      { key: "datasets", count: 1, label: "1 dataset" },
      { key: "templates", count: 0, label: "0 templates" },
    ]);
  });

  it("formats linked workspace and scan success messages", () => {
    expect(getLinkedWorkspaceCountLabel(1, t)).toBe("1 workspace linked");
    expect(getLinkedWorkspaceCountLabel(3, t)).toBe("3 workspaces linked");
    expect(getScanSuccessMessage({ runs_count: 1, exports_count: 2 }, t)).toBe(
      "Scanned: 1 run, 2 exports",
    );
    expect(getScanSuccessMessage(undefined, t)).toBe("Scanned: 0 runs, 0 exports");
  });

  it("returns a scanned label only when a scan timestamp exists", () => {
    const formatter = (value: string) => `relative:${value}`;

    expect(getLastScannedLabel(null, t, formatter)).toBeNull();
    expect(getLastScannedLabel("2026-06-30T08:00:00Z", t, formatter)).toBe(
      "Scanned relative:2026-06-30T08:00:00Z",
    );
  });

  it("describes active and inactive workspace item state", () => {
    const active = getWorkspaceItemState({ is_active: true }, t);
    const inactive = getWorkspaceItemState({ is_active: false }, t);

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
    const copy = getWorkspaceActionCopy(t);

    expect(copy.activate).toEqual({
      label: "Activate",
      tooltip: "Set as active workspace",
    });
    expect(copy.scan.tooltip).toBe("Rescan workspace");
    expect(copy.unlink.confirmLabel).toBe("Unlink");
  });
});
