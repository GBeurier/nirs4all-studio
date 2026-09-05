/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArchiveV2ArrayPredictionResponse } from "@/types/archiveV2Prediction";

import { ArchiveV2PredictionResults } from "./ArchiveV2PredictionResults";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const result: ArchiveV2ArrayPredictionResponse = {
  schema_version: 1,
  operation: "archive_v2_predict",
  archive_id: "archive:test",
  archive_sha256: "a".repeat(64),
  engine: "core_rust_methods",
  fallback_used: false,
  sample_ids: ["sample-one"],
  target_names: ["protein"],
  values: [[1.5]],
  provenance: {
    executor: `nirs4all-core@0.3.29+libn4m-abi-2.5:${"b".repeat(64)}`,
    archive_ref: "models/test.n4a",
    workspace_id: "workspace:test",
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ArchiveV2PredictionResults", () => {
  it("offers and downloads the native prediction CSV", async () => {
    const createObjectUrl = vi.fn(() => "blob:archive-v2-csv");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ArchiveV2PredictionResults
          result={result}
          conformal={null}
          conformalError={null}
          onReset={vi.fn()}
        />,
      );
    });
    const exportButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Export CSV"),
    );
    expect(exportButton).toBeDefined();
    await act(async () => exportButton?.click());

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:archive-v2-csv");
    await act(async () => root.unmount());
    container.remove();
  });
});
