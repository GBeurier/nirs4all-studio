import { describe, expect, it } from "vitest";

import type { RunProgressState } from "@/context/useActiveRuns";
import {
  buildFloatingRunWidgetReadModel,
  buildRunItemReadModel,
  getMinimizedBadgeCount,
  getRecentRunLogs,
  getRunDetailPath,
  selectFloatingRun,
  shouldShowFloatingRunWidget,
} from "../FloatingRunWidgetData";

function run(overrides: Partial<RunProgressState> = {}): RunProgressState {
  return {
    runId: "run-a",
    runName: "Run A",
    status: "running",
    progress: 42,
    message: "Training",
    logs: [],
    updatedAt: 1,
    ...overrides,
  };
}

describe("FloatingRunWidgetData", () => {
  it("hides only when no active runs exist or a concrete run detail page is open", () => {
    expect(shouldShowFloatingRunWidget("/", true)).toBe(true);
    expect(shouldShowFloatingRunWidget("/runs/", true)).toBe(true);
    expect(shouldShowFloatingRunWidget("/runs/run-a", true)).toBe(false);
    expect(shouldShowFloatingRunWidget("/", false)).toBe(false);
  });

  it("selects the requested run and falls back to the first active run", () => {
    const runs = [run({ runId: "run-a" }), run({ runId: "run-b" })];

    expect(selectFloatingRun(runs, "run-b")?.runId).toBe("run-b");
    expect(selectFloatingRun(runs, "missing")?.runId).toBe("run-a");
    expect(selectFloatingRun([], "run-a")).toBeUndefined();
  });

  it("builds badge counts, item labels, classes, logs, and navigation paths", () => {
    const selectedItem = buildRunItemReadModel(run({ progress: 7 }), true);
    const idleItem = buildRunItemReadModel(run({ progress: 81 }), false);

    expect(getMinimizedBadgeCount([run(), run({ runId: "run-b" })])).toBe(2);
    expect(selectedItem).toMatchObject({
      progress: 7,
      progressLabel: "7%",
      containerClassName: "bg-chart-2/10 border border-chart-2/30",
    });
    expect(idleItem.containerClassName).toBe("hover:bg-muted/50");
    expect(getRecentRunLogs(["a", "b", "c", "d"])).toEqual(["b", "c", "d"]);
    expect(getRunDetailPath("run-a")).toBe("/runs/run-a");
    expect(getRunDetailPath(undefined)).toBeNull();
  });

  it("builds the widget read model flags for multi-run and selected-run detail state", () => {
    const model = buildFloatingRunWidgetReadModel({
      pathname: "/experiments",
      hasActiveRuns: true,
      activeRuns: [
        run({ runId: "run-a", logs: ["one"] }),
        run({ runId: "run-b", logs: ["first", "second", "third", "fourth"] }),
      ],
      selectedRunId: "run-b",
    });

    expect(model.isVisible).toBe(true);
    expect(model.selectedRun?.runId).toBe("run-b");
    expect(model.minimizedBadgeCount).toBe(2);
    expect(model.runItems.map((item) => [item.runId, item.containerClassName])).toEqual([
      ["run-a", "hover:bg-muted/50"],
      ["run-b", "bg-chart-2/10 border border-chart-2/30"],
    ]);
    expect(model.recentLogs).toEqual(["second", "third", "fourth"]);
    expect(model.detailPath).toBe("/runs/run-b");
    expect(model.showRunSelector).toBe(true);
    expect(model.showSingleRunSummary).toBe(false);
    expect(model.showRecentLogs).toBe(true);
  });

  it("builds the widget read model flags for a single run without logs", () => {
    const model = buildFloatingRunWidgetReadModel({
      pathname: "/experiments",
      hasActiveRuns: true,
      activeRuns: [run()],
      selectedRunId: null,
    });

    expect(model.selectedRun?.runId).toBe("run-a");
    expect(model.showRunSelector).toBe(false);
    expect(model.showSingleRunSummary).toBe(true);
    expect(model.showRecentLogs).toBe(false);
  });

  it("marks the fallback selected run item when the selected id is missing", () => {
    const model = buildFloatingRunWidgetReadModel({
      pathname: "/experiments",
      hasActiveRuns: true,
      activeRuns: [run({ runId: "run-a" }), run({ runId: "run-b" })],
      selectedRunId: "missing",
    });

    expect(model.selectedRun?.runId).toBe("run-a");
    expect(model.runItems.map((item) => item.containerClassName)).toEqual([
      "bg-chart-2/10 border border-chart-2/30",
      "hover:bg-muted/50",
    ]);
  });
});
