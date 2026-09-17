import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/react";

vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  close: vi.fn().mockResolvedValue(true),
  ErrorBoundary: vi.fn(),
}));

describe("Sentry initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("__APP_VERSION__", "9.8.7");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("honors an explicitly empty DSN in test builds", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const { initSentry, sentryEnabled } = await import("./sentry");
    expect(initSentry()).toBe(false);
    expect(sentryEnabled).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("reports the compiled app version with a custom DSN", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.com/1");
    const { initSentry } = await import("./sentry");
    expect(initSentry()).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: "https://public@example.com/1",
      release: "nirs4all-studio@9.8.7",
      sendDefaultPii: false,
    }));
    expect(initSentry()).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });

  it("uses the product DSN when no override is configured", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", undefined);
    const { initSentry } = await import("./sentry");
    expect(initSentry()).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: expect.stringContaining(".ingest.de.sentry.io/"),
      release: "nirs4all-studio@9.8.7",
    }));
  });
});
