/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ post: vi.fn(), requestForm: vi.fn() }));
vi.mock("./transport", () => ({ api: { post: transport.post }, requestForm: transport.requestForm }));
import { linkDataset, previewDatasetWithUploads } from "./datasets";

beforeEach(() => vi.resetAllMocks());

it("uploads dataset bytes and metadata in the body without substituting a local path", async () => {
  const file = new File(["1,2\n3,4\n"], "X.csv", { type: "text/csv" });
  const config = { files: [{ path: "X.csv", type: "X", split: "train" }] };
  const linked = { success: true, dataset: { id: "linked" } };
  transport.requestForm.mockResolvedValue(linked);
  expect(await linkDataset("", config, [file])).toBe(linked);
  expect(transport.post).not.toHaveBeenCalled();
  const [url, body] = transport.requestForm.mock.calls[0] as [string, FormData];
  expect(url).toBe("/datasets/upload");
  expect(body.getAll("files")).toEqual([file]);
  expect(JSON.parse(body.get("metadata") as string)).toEqual({ config });
});

it("keeps preview metadata out of the URL and never retries an upload failure as a path link", async () => {
  const file = new File(["1,2"], "X.csv");
  const files = [{ path: "X.csv", type: "X" as const, split: "train" as const, source: null }];
  transport.requestForm.mockResolvedValue({ success: true });
  await previewDatasetWithUploads([file], files, { has_header: false }, 5);
  const [url, body] = transport.requestForm.mock.calls[0] as [string, FormData];
  expect(url).toBe("/datasets/preview-upload");
  expect(JSON.parse(body.get("metadata") as string)).toEqual({ files, parsing: { has_header: false }, max_samples: 5 });
  transport.requestForm.mockRejectedValue(new Error("Reader rejected data"));
  await expect(linkDataset("", { files }, [file])).rejects.toThrow("Reader rejected data");
  expect(transport.post).not.toHaveBeenCalled();
});
