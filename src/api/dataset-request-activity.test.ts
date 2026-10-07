/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { hasDatasetRequestInFlight, withDatasetRequestActivity } from "./dataset-request-activity";
import { linkDataset, previewDataset, previewDatasetWithUploads } from "./datasets";

const transport = vi.hoisted(() => ({ post: vi.fn(), requestForm: vi.fn() }));
vi.mock("./transport", () => ({ api: { post: transport.post }, requestForm: transport.requestForm }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("dataset request activity", () => {
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
