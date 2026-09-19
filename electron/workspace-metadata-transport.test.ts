import { describe, expect, it } from "vitest";
import { preselectRendererTransport } from "./renderer-transport-selection";

const running = () => ({ status: "running" as const, url: "http://127.0.0.1:43123", pythonPluginHostConfigured: false });
const capabilities = () => Promise.resolve(new Response(JSON.stringify({
  protocol_version: "studio-sidecar-r1",
  features: { renderer_transport_selection: true, renderer_rust_only_default: true,
    implicit_python_http_fallback: false, unmigrated_renderer_routes_fail_closed: true,
    renderer_http_transport: true, scientific_execution: false, workspace_document_routes: true, workspace_metadata_routes: true },
}), { status: 200 }));

describe("workspace metadata transport", () => {
  it("qualifies catalogue and preferences without starting Python", async () => {
    for (const [method, path] of [
      ["GET", "/workspace/settings"], ["PUT", "/workspace/settings"],
      ["GET", "/workspace/data-defaults"], ["PUT", "/workspace/data-defaults"],
      ["GET", "/workspace/recent"], ["GET", "/workspace/recent?limit=10"],
      ["POST", "/workspace/groups"], ["PUT", "/workspace/groups/group-1"],
      ["DELETE", "/workspace/groups/group-1"], ["POST", "/workspace/groups/group-1/datasets"],
      ["DELETE", "/workspace/groups/group-1/datasets/dataset_1"],
    ]) {
      const result = await preselectRendererTransport({ kind: "http", method, path }, running, capabilities);
      expect(result, `${method} ${path}: ${JSON.stringify(result)}`).toMatchObject({ target: "native-sidecar" });
    }
  });
  it("rejects unsupported operations and malformed identifiers or limits", async () => {
    for (const [method, path] of [
      ["DELETE", "/workspace/settings"], ["POST", "/workspace/data-defaults"],
      ["GET", "/workspace/settings?path=other"], ["GET", "/workspace/recent?limit=0"],
      ["GET", "/workspace/recent?limit=257"], ["GET", "/workspace/recent?limit=1&limit=2"],
      ["GET", "/workspace/recent?limit=-1"], ["GET", "/workspace/recent?limit="],
      ["GET", "/workspace/recent?limit=1?limit=2"], ["GET", "/workspace/recent?path=/other"],
      ["PUT", "/workspace/groups/.."], ["DELETE", "/workspace/groups/%2F"],
      ["DELETE", "/workspace/groups/g1/datasets/.."],
      ["DELETE", "/workspace/groups/g1/datasets/%00"],
      ["POST", "/workspace/groups/g1/datasets/d1"],
    ]) {
      await expect(preselectRendererTransport({ kind: "http", method, path }, running, capabilities))
        .resolves.toMatchObject({ target: "reject" });
    }
  });
});
