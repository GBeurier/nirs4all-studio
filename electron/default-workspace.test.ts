import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureDesktopWorkspace } from "./default-workspace";

describe("desktop first workspace", () => {
  const base = "http://127.0.0.1:4123";
  const documents = path.resolve("Documents with spaces");
  it("creates and selects a workspace under the OS Documents directory", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ workspaces: [] }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ success: true }));
    await ensureDesktopWorkspace(base, documents, request);
    const body = JSON.parse(request.mock.calls[1][1]?.body as string);
    expect(body.path).toBe(path.join(documents, "nirs4all Studio", "workspace"));
    expect(request.mock.calls[2][0]).toBe(`${base}/api/workspace/select`);
  });
  it("preserves an existing catalogue even when its drive is unavailable", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      workspaces: [{ path: "/unavailable/drive", is_active: true }],
    }));
    await ensureDesktopWorkspace(base, documents, request);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("relinks existing workspace contents after configuration was removed", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ workspaces: [] }))
      .mockResolvedValueOnce(Response.json({ detail: "already exists" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    await ensureDesktopWorkspace(base, documents, request);
    expect(request.mock.calls[2][0]).toBe(`${base}/api/workspace/select`);
  });
  it("reports a permissions error without pretending setup succeeded", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ workspaces: [] }))
      .mockResolvedValueOnce(new Response("Access denied", { status: 403 }));
    await expect(ensureDesktopWorkspace(base, documents, request)).rejects.toThrow("Access denied");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
