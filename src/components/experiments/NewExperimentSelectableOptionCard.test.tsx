/** @vitest-environment jsdom */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { NewExperimentSelectableOptionCard } from "./NewExperimentSelectableOptionCard";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("run input selection", () => {
  it.each(["data-experiment-pipeline-id", "data-experiment-dataset-id"] as const)("toggles %s exactly once for checkbox and card clicks", async (attribute) => {
    function Selection() {
      const [selected, setSelected] = useState(false);
      return <NewExperimentSelectableOptionCard dataAttributeName={attribute} optionId="test" selected={selected} onToggle={() => setSelected(value => !value)}>
        <span>Input for run</span>
      </NewExperimentSelectableOptionCard>;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<Selection />); });
      const checkbox = container.querySelector<HTMLElement>('[role="checkbox"]')!;
      await act(async () => { checkbox.click(); });
      expect(checkbox.getAttribute("aria-checked")).toBe("true");
      await act(async () => { checkbox.click(); });
      expect(checkbox.getAttribute("aria-checked")).toBe("false");
      await act(async () => { container.querySelector("span")!.click(); });
      expect(checkbox.getAttribute("aria-checked")).toBe("true");
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
    }
  });
});
