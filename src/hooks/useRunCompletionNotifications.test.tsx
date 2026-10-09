/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunProgressState } from "@/context/useActiveRuns";
import { useRunCompletionNotifications } from "./useRunCompletionNotifications";

const mocks = vi.hoisted(() => ({
  active: [] as RunProgressState[],
  final: new Map<string, RunProgressState>(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, values?: { name?: string }) => `${key}:${values?.name ?? ""}` }),
}));
vi.mock("@/context/useActiveRuns", () => ({
  useActiveRuns: () => ({
    activeRuns: mocks.active,
    getRunProgress: (id: string) => mocks.final.get(id),
  }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function run(status: RunProgressState["status"], message = ""): RunProgressState {
  return { runId: "run-1", runName: "PLS", status, progress: 0, message, logs: [], updatedAt: 0 };
}

function Probe() {
  useRunCompletionNotifications();
  return null;
}

class FakeNotification {
  static permission = "granted";
  static instances: FakeNotification[] = [];
  onclick?: () => void;
  constructor(public title: string, public options?: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}

describe("useRunCompletionNotifications", () => {
  let root: ReturnType<typeof createRoot>;
  const render = () => act(async () => root.render(<MemoryRouter><Probe /></MemoryRouter>));

  beforeEach(() => {
    root = createRoot(document.createElement("div"));
    mocks.active = [];
    mocks.final.clear();
    FakeNotification.instances = [];
    FakeNotification.permission = "granted";
    vi.stubGlobal("Notification", FakeNotification);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  async function finish(status: RunProgressState["status"], message = "") {
    mocks.active = [run("running")];
    await render();
    mocks.active = [];
    mocks.final.set("run-1", run(status, message));
    await render();
  }

  it("shows one toast with a view action when a run completes in the foreground", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    await finish("completed");
    await render();
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.success.mock.calls[0][0]).toBe('runs.notifications.completed:PLS');
    expect(mocks.success.mock.calls[0][1].action.label).toBe("runs.notifications.viewRun:");
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("also raises a desktop notification when the window is unfocused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await finish("completed");
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toBe("runs.notifications.completed:PLS");
  });

  it("only sends a desktop notification for failures", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await finish("failed", "boom");
    expect(mocks.success).not.toHaveBeenCalled();
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it("stays silent for cancelled runs", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await finish("failed", "Cancelled");
    expect(mocks.success).not.toHaveBeenCalled();
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("skips the desktop notification without permission but keeps the toast", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    FakeNotification.permission = "denied";
    await finish("completed");
    expect(FakeNotification.instances).toHaveLength(0);
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });
});
