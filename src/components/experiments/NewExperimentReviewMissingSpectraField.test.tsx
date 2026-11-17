import "@/lib/__tests__/support/experimentI18n";
/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MissingSpectraPolicy } from "@/types/runs";
import { NewExperimentReviewMissingSpectraField } from "./NewExperimentReviewMissingSpectraField";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
  });
  return container;
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

const counts = [{ datasetId: "e", datasetName: "X gaps", samples: 5, values: 25, totalSamples: 120 }];

describe("NewExperimentReviewMissingSpectraField", () => {
  it("asks nothing when no selected dataset keeps missing spectral values", async () => {
    const host = await render(<NewExperimentReviewMissingSpectraField counts={[]} choice={null} onChange={vi.fn()} />);
    expect(host.textContent).toBe("");
  });

  it("shows the counts and three choices, none of them preselected", async () => {
    const onChange = vi.fn();
    const host = await render(<NewExperimentReviewMissingSpectraField counts={counts} choice={null} onChange={onChange} />);
    expect(host.textContent).toContain("X gaps: 25 missing values in 5 of 120 samples");
    expect(host.textContent).toContain("Choose one of the options to continue.");
    const radios = [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")];
    expect(radios.map((radio) => radio.id)).toEqual(["missing-spectra-policy-remove", "missing-spectra-policy-replace", "missing-spectra-policy-keep"]);
    expect(radios.every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
    await act(async () => { radios[0].click(); });
    expect(onChange).toHaveBeenLastCalledWith({ policy: "remove" });
    await act(async () => { radios[1].click(); });
    expect(onChange).toHaveBeenLastCalledWith({ policy: "replace", fill: { method: "value", fill_value: 0 } });
    await act(async () => { radios[2].click(); });
    expect(onChange).toHaveBeenLastCalledWith({ policy: "keep" });
  });

  it("offers the library's replacement methods once replacement is chosen", async () => {
    const choice: MissingSpectraPolicy = { policy: "replace", fill: { method: "value", fill_value: 1.5 } };
    const host = await render(<NewExperimentReviewMissingSpectraField counts={counts} choice={choice} onChange={vi.fn()} />);
    expect(host.textContent).not.toContain("Choose one of the options to continue.");
    expect(host.querySelector("#missing-spectra-policy-replace")?.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector<HTMLInputElement>("input[type=number]")?.value).toBe("1.5");
    expect(host.textContent).toContain("A constant value");
  });
});
