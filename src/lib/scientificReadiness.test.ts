import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/transport", () => ({ api: { get: vi.fn() } }));
import { waitForScientificReadiness } from "./scientificReadiness";

describe("scientific readiness after a sidecar start", () => {
  it("waits while the scientific host is still being acquired", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ ml_ready: false, ml_loading: true, ml_error: null })
      .mockResolvedValueOnce({ ml_ready: false, ml_loading: true, ml_error: null })
      .mockResolvedValueOnce({ ml_ready: true, ml_loading: false, ml_error: null });
    await expect(waitForScientificReadiness(read, { intervalMs: 1 })).resolves.toEqual({ ml_ready: true, ml_loading: false, ml_error: null });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("returns a failed acquisition and gives up waiting after the deadline", async () => {
    const failed = { ml_ready: false, ml_loading: false, ml_error: "scientific_distribution_version_unsupported" };
    await expect(waitForScientificReadiness(vi.fn().mockResolvedValue(failed), { intervalMs: 1 })).resolves.toEqual(failed);
    const loading = vi.fn().mockResolvedValue({ ml_ready: false, ml_loading: true });
    await expect(waitForScientificReadiness(loading, { intervalMs: 1, timeoutMs: 0 })).resolves.toEqual({ ml_ready: false, ml_loading: true });
    expect(loading).toHaveBeenCalledTimes(1);
  });
});
