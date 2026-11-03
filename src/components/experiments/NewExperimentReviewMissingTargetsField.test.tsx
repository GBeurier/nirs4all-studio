import "@/lib/__tests__/support/experimentI18n";
/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewExperimentReviewMissingTargetsField } from "./NewExperimentReviewMissingTargetsField";

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

function radio(host: HTMLElement, value: string): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(`button[role="radio"][value="${value}"]`)!;
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe("NewExperimentReviewMissingTargetsField", () => {
  it("asks the question with exclude-and-predict selected by default", async () => {
    const host = await render(
      <NewExperimentReviewMissingTargetsField
        missingTargetPolicy="predict"
        removalAvailable
        onMissingTargetPolicyChange={vi.fn()}
      />,
    );

    expect(host.textContent).toContain("Samples without a target value");
    expect(host.textContent).toContain("Exclude them from training and predict them");
    expect(host.textContent).toContain("Remove these samples");
    expect(radio(host, "predict").getAttribute("aria-checked")).toBe("true");
    expect(radio(host, "remove").getAttribute("aria-checked")).toBe("false");
    expect(radio(host, "remove").disabled).toBe(false);
  });

  it("reports the remove choice", async () => {
    const onChange = vi.fn();
    const host = await render(
      <NewExperimentReviewMissingTargetsField
        missingTargetPolicy="predict"
        removalAvailable
        onMissingTargetPolicyChange={onChange}
      />,
    );

    await act(async () => {
      radio(host, "remove").click();
    });

    expect(onChange).toHaveBeenCalledWith("remove");
  });

  it("disables removal and explains why when a selected dataset is multimodal", async () => {
    const host = await render(
      <NewExperimentReviewMissingTargetsField
        missingTargetPolicy="predict"
        removalAvailable={false}
        onMissingTargetPolicyChange={vi.fn()}
      />,
    );

    expect(radio(host, "remove").disabled).toBe(true);
    expect(host.textContent).toContain("Not available for multimodal datasets");
  });
});
