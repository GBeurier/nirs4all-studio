import { describe, expect, it } from "vitest";

import { INSPECTOR_PANELS, PANEL_MAP } from "@/lib/inspector/chartRegistry";
import type { InspectorPanelType } from "@/types/inspector";

// Compiler-enforced enumeration of every panel type. Adding a member to the
// `InspectorPanelType` union without listing it here is a type error, which
// forces new meta-analysis panels to be wired into the registry as well.
const ALL_PANEL_TYPES = {
  scatter: true,
  residuals: true,
  rankings: true,
  histogram: true,
  heatmap: true,
  candlestick: true,
  branch_comparison: true,
  branch_topology: true,
  fold_stability: true,
  confusion: true,
  preprocessing_impact: true,
  hyperparameter: true,
  bias_variance: true,
} satisfies Record<InspectorPanelType, true>;

const EXPECTED_PANEL_IDS = Object.keys(ALL_PANEL_TYPES).sort() as InspectorPanelType[];

describe("inspector chart registry", () => {
  it("defines exactly one panel for every InspectorPanelType", () => {
    const registryIds = INSPECTOR_PANELS.map(p => p.id).sort();
    expect(registryIds).toEqual(EXPECTED_PANEL_IDS);
  });

  it("uses unique panel ids", () => {
    const ids = INSPECTOR_PANELS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses unique priorities so panel ordering is deterministic", () => {
    const priorities = INSPECTOR_PANELS.map(p => p.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it("keeps PANEL_MAP consistent with INSPECTOR_PANELS", () => {
    expect(PANEL_MAP.size).toBe(INSPECTOR_PANELS.length);
    for (const panel of INSPECTOR_PANELS) {
      expect(PANEL_MAP.get(panel.id)).toBe(panel);
    }
  });

  it("provides human-facing copy for every panel", () => {
    for (const panel of INSPECTOR_PANELS) {
      expect(panel.name.trim().length).toBeGreaterThan(0);
      expect(panel.shortName.trim().length).toBeGreaterThan(0);
      expect(panel.help.trim().length).toBeGreaterThan(0);
      expect(typeof panel.defaultVisible).toBe("boolean");
    }
  });
});
