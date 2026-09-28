/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ImportMultimodalDialog } from "./ImportMultimodalDialog";

vi.mock("react-i18next", () => ({ useTranslation: () => ({
  t: (key: string, values?: { samples: number; sources: number; alignment: string }) => {
    if (key === "datasets.multimodalImport.summary" && values) {
      return `${values.samples} samples · ${values.sources} sources · ${values.alignment} alignment`;
    }
    return key === "datasets.multimodalImport.submit" ? "Import dataset" : key;
  },
}) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

it("imports a selected typed cohort and exposes the scientific error without losing the selection", async () => {
  const descriptor = {
    schema: "nirs4all.studio-multimodal-dataset.v1",
    cohort: { schema: "nirs4all.multimodal-dataset", schema_version: 1,
      sample_ids: ["s1", "s2"],
      sources: [{ name: "nir", sample_ids: ["s1", "s2"], representation_id: "signal_1d", array: { shape: [2, 2] } }],
      partitions: { values: ["train", "test"] } },
  };
  const onImport = vi.fn().mockRejectedValueOnce(new Error("Cohort reader rejected values")).mockResolvedValueOnce(undefined);
  const onOpenChange = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = async () => { await act(async () => root.unmount()); container.remove(); };
  await act(async () => root.render(<ImportMultimodalDialog open onOpenChange={onOpenChange} onImport={onImport} />));
  const file = new File([JSON.stringify(descriptor)], "cohort.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(descriptor) });
  const input = document.querySelector<HTMLInputElement>('#multimodal-descriptor-file')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(document.body.textContent).toContain("2 samples · 1 sources");
  const submit = [...document.querySelectorAll("button")].find(button => button.textContent?.includes("Import dataset"))!;
  await act(async () => submit.click());
  expect(onImport).toHaveBeenCalledWith("cohort", descriptor);
  expect(document.body.textContent).toContain("Cohort reader rejected values");
  await act(async () => submit.click());
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
