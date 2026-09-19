/** @vitest-environment jsdom */
import { expect, it } from "vitest";
import { duringRuntimeMutation, isRuntimeMutationRequest, RUNTIME_MUTATION_EVENT } from "./runtimeMutationEvents";

it("tracks overlapping requests and releases readiness polling after a failed installer", async () => {
  const pending: boolean[] = [];
  const listener = (event: Event) => pending.push((event as CustomEvent<{ pending: boolean }>).detail.pending);
  window.addEventListener(RUNTIME_MUTATION_EVENT, listener);
  let finish!: () => void;
  try {
    const first = duringRuntimeMutation(() => new Promise<void>(resolve => { finish = resolve; }));
    const second = duringRuntimeMutation(async () => { throw new Error("pip failed"); });
    await expect(second).rejects.toThrow("pip failed");
    expect(pending).toEqual([true, true, true]);
    finish();
    await first;
    expect(pending).toEqual([true, true, true, false]);
  } finally {
    window.removeEventListener(RUNTIME_MUTATION_EVENT, listener);
  }
});

it("does not block analyses for previews or unrelated settings requests", () => {
  expect(isRuntimeMutationRequest("/config/align", { dry_run: true })).toBe(false);
  expect(isRuntimeMutationRequest("/config/align", { dry_run: false })).toBe(true);
  expect(isRuntimeMutationRequest("/updates/dependencies/install", { package: "tabpfn" })).toBe(true);
  expect(isRuntimeMutationRequest("/updates/runtime/snapshots/saved/restore")).toBe(true);
  expect(isRuntimeMutationRequest("/updates/settings")).toBe(false);
});
