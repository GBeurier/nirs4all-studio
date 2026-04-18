/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatApiErrorDetail,
  getConfigDiff,
  getRecommendedConfig,
  resetBackendUrl,
} from "./client";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetBackendUrl();
});

afterEach(() => {
  resetBackendUrl();
  vi.unstubAllGlobals();
  delete (window as Window & { electronApi?: unknown }).electronApi;
});

describe("formatApiErrorDetail", () => {
  it("formats FastAPI validation arrays into readable messages", () => {
    const detail = [
      {
        type: "string_too_long",
        loc: ["body", "config", "name"],
        msg: "String should have at most 100 characters",
      },
    ];

    expect(formatApiErrorDetail(detail, 422)).toBe(
      "config.name: String should have at most 100 characters",
    );
  });

  it("passes string details through unchanged", () => {
    expect(formatApiErrorDetail("Dataset not found", 404)).toBe("Dataset not found");
  });
});

describe("API client request handling", () => {
  it("retries once with a refreshed backend URL after a transient Electron fetch failure", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({
        schema_version: "1.2",
        app_version: "0.6.0",
        nirs4all: "0.9.0",
        profiles: [],
        optional: [],
        fetched_from: "bundled",
        fetched_at: "2026-04-18T08:00:00",
      }));
    vi.stubGlobal("fetch", fetchMock);

    const getBackendUrl = vi.fn()
      .mockResolvedValueOnce("http://127.0.0.1:39026")
      .mockResolvedValueOnce("http://127.0.0.1:39027");
    const getBackendInfo = vi.fn().mockResolvedValue({
      status: "running",
      port: 39027,
      url: "http://127.0.0.1:39027",
      restartCount: 3,
    });
    (window as Window & { electronApi?: unknown }).electronApi = {
      isElectron: true,
      getBackendUrl,
      getBackendInfo,
    };

    const result = await getRecommendedConfig();

    expect(result.fetched_from).toBe("bundled");
    expect(getBackendUrl).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:39026/api/config/recommended",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:39027/api/config/recommended",
      expect.any(Object),
    );
    expect(getBackendInfo).toHaveBeenCalledTimes(1);
  });

  it("adds include_latest=false only when the caller disables latest-version lookup", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      profile: "cpu",
      profile_label: "CPU",
      packages: [],
      aligned_count: 0,
      misaligned_count: 0,
      missing_count: 0,
      is_aligned: true,
      checked_at: "2026-04-18T08:00:00",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await getConfigDiff("cpu", false, false);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/config/diff?profile=cpu&include_latest=false",
      expect.any(Object),
    );
  });
});
