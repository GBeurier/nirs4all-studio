/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeAll } from "vitest";
import i18n from "@/lib/i18n";
import { ActiveRunContext, type RunProgressState } from "@/context/useActiveRuns";
import { ProgressOverviewCard } from "@/components/runs/RunProgressSections";
import { FloatingRunWidget } from "../FloatingRunWidget";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

function renderWidget(runs: RunProgressState[]) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/datasets"]}>
      <ActiveRunContext.Provider value={{
        activeRuns: runs, hasActiveRuns: true, isMinimized: false,
        getRunProgress: () => undefined, refreshActiveRuns: vi.fn(), toggleMinimized: vi.fn(),
        selectedRunId: null, selectRun: vi.fn(),
      }}>
        <FloatingRunWidget />
      </ActiveRunContext.Provider>
    </MemoryRouter>,
  );
  return container;
}

const unavailableRun: RunProgressState = {
  runId: "run-rf", runName: "RF", status: "running", progress: 0,
  progressUnavailable: true, message: "Fit progress is unavailable.", logs: [], updatedAt: 1,
};

describe("unavailable fit progress presentation", () => {
  it("renders single and multiple active runs without a false zero percentage", () => {
    for (const runs of [[unavailableRun], [unavailableRun, { ...unavailableRun, runId: "run-two" }]]) {
      const widget = renderWidget(runs);
      expect(widget.textContent).toContain("Unavailable");
      expect(widget.textContent).not.toContain("0%");
      const bars = widget.querySelectorAll('[role="progressbar"]');
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) {
        expect(bar.getAttribute("aria-valuetext")).toBe("Fit progress unavailable");
        expect(bar.hasAttribute("aria-valuenow")).toBe(false);
      }
    }
    expect(renderWidget([{ ...unavailableRun, progress: 37, progressUnavailable: false }]).textContent)
      .toContain("37%");
  });

  it("renders the full progress page overview as indeterminate too", () => {
    const html = renderToStaticMarkup(<ProgressOverviewCard
      primaryText="Scientific computation running" secondaryText="Fit progress is unavailable."
      overallProgress={0} progressUnavailable
    />);
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("0%");
    expect(html).toContain('aria-valuetext="Fit progress unavailable"');
    expect(html).not.toContain("aria-valuenow");
  });
});
