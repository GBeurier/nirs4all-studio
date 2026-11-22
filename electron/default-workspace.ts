import path from "node:path";

/** Restore the first-launch workspace using the OS's actual Documents folder. */
export async function ensureDesktopWorkspace(
  baseUrl: string,
  documentsDirectory: string,
  request: typeof fetch,
): Promise<void> {
  const call = async (route: string, body?: object) => {
    const response = await request(`${baseUrl}/api${route}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Workspace initialization failed (${response.status}): ${await response.text()}`);
    }
    return response.json() as Promise<Record<string, unknown>>;
  };
  // The full workspace catalogue scans linked directories. Startup only
  // needs the persisted count, even if one of those directories is slow.
  const { linked_workspaces_count: workspaceCount } = await call("/app/settings");
  if (typeof workspaceCount !== "number" || !Number.isSafeInteger(workspaceCount) || workspaceCount < 0) {
    throw new Error("The linked workspace count is invalid");
  }
  // Preserve the user's catalogue and active workspace, including unavailable
  // removable/network drives. A missing drive is not a first installation.
  if (workspaceCount > 0) return;
  const workspacePath = path.join(documentsDirectory, "nirs4all Studio", "workspace");
  const response = await request(`${baseUrl}/api/workspace/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: workspacePath, name: "Default Workspace", create_dir: true }),
    signal: AbortSignal.timeout(10_000),
  });
  // A prior installation can have a workspace but no remaining catalogue.
  // Re-link it without replacing its metadata or contents.
  if (!response.ok && response.status !== 409) {
    throw new Error(`Workspace creation failed (${response.status}): ${await response.text()}`);
  }
  await call("/workspace/select", { path: workspacePath });
}
