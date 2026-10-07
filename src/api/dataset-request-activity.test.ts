/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { hasDatasetRequestInFlight, withDatasetRequestActivity } from "./dataset-request-activity";
import { detectFormat, linkDataset, previewDataset, previewDatasetWithUploads, validateFiles } from "./datasets";

const transport = vi.hoisted(() => ({ post: vi.fn(), requestForm: vi.fn() }));
vi.mock("./transport", () => ({ api: { post: transport.post }, requestForm: transport.requestForm }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("dataset request activity", () => {
  it("tracks format detection and validation until each real inspection settles", async () => {
    const detection = deferred<unknown>();
    const validation = deferred<unknown>();
    transport.post.mockReturnValueOnce(detection.promise).mockReturnValueOnce(validation.promise);
    const first = detectFormat({ path: "/owned/y.csv", sample_rows: 100 });
    const second = validateFiles("/owned", [], { delimiter: "," });
    expect(hasDatasetRequestInFlight()).toBe(true);
    const refusal = new Error("Invalid parsing");
    const assertion = expect(first).rejects.toBe(refusal);
    detection.reject(refusal);
    await assertion;
    expect(hasDatasetRequestInFlight()).toBe(true);
    validation.resolve({ success: true, shapes: {} });
    await second;
    expect(hasDatasetRequestInFlight()).toBe(false);
    expect(transport.post).toHaveBeenCalledWith("/datasets/detect-format", { path: "/owned/y.csv", sample_rows: 100 });
    expect(transport.post).toHaveBeenCalledWith("/datasets/validate-files", { path: "/owned", files: [], parsing: { delimiter: "," }, per_file_overrides: undefined });
  });
  it("tracks overlapping real preview/link requests until both finish", async () => {
    const preview = deferred<unknown>();
    const link = deferred<unknown>();
    transport.post.mockReturnValueOnce(preview.promise).mockReturnValueOnce(link.promise);
    const first = previewDataset({ path: "/owned", files: [], parsing: {} });
    const second = linkDataset("/owned", {});
    expect(hasDatasetRequestInFlight()).toBe(true);
    preview.resolve({ success: true });
    await first;
    expect(hasDatasetRequestInFlight()).toBe(true);
    link.resolve({ success: true });
    await second;
    expect(hasDatasetRequestInFlight()).toBe(false);
    expect(transport.post).toHaveBeenCalledWith("/datasets/preview", { path: "/owned", files: [], parsing: {} });
    expect(transport.post).toHaveBeenCalledWith("/datasets/link", { path: "/owned", config: {} });
  });

  it("releases activity after a cancelled preview without changing its error", async () => {
    const cancelled = deferred<unknown>();
    transport.post.mockReturnValueOnce(cancelled.promise);
    const request = previewDataset({ path: "/owned", files: [], parsing: {} });
    const error = new DOMException("cancelled", "AbortError");
    const assertion = expect(request).rejects.toBe(error);
    cancelled.reject(error);
    await assertion;
    expect(hasDatasetRequestInFlight()).toBe(false);
  });

  it("releases activity when a callback throws before returning a promise", async () => {
    const error = new Error("request refused");
    await expect(withDatasetRequestActivity(() => { throw error; })).rejects.toBe(error);
    expect(hasDatasetRequestInFlight()).toBe(false);
  });

  it.each(["preview", "link"])("tracks uploaded %s bodies without altering their transport", async (kind) => {
    const pending = deferred<unknown>();
    transport.requestForm.mockReturnValueOnce(pending.promise);
    const files = [new File(["1,2"], "x.csv")];
    const request = kind === "preview"
      ? previewDatasetWithUploads(files, [], {})
      : linkDataset("/owned", {}, files);
    expect(hasDatasetRequestInFlight()).toBe(true);
    const [endpoint, body] = transport.requestForm.mock.calls.at(-1)!;
    expect(endpoint).toBe(kind === "preview" ? "/datasets/preview-upload" : "/datasets/upload");
    expect(body.getAll("files")).toEqual(files);
    pending.resolve({ success: true });
    await request;
    expect(hasDatasetRequestInFlight()).toBe(false);
  });
});
