import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { invalidatePredictionRelatedQueries } from "../prediction-deletion";

describe("prediction deletion query invalidation", () => {
  it("invalidates workspace score caches alongside prediction views", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(["workspaces", "ws-1", "scores"], { datasets: [] });
    queryClient.setQueryData(["results-summary", "ws-1"], { datasets: [] });
    queryClient.setQueryData(["datasets", "list"], { datasets: [] });

    await invalidatePredictionRelatedQueries(queryClient);

    expect(
      queryClient.getQueryCache().find({ queryKey: ["workspaces", "ws-1", "scores"] })?.state.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryCache().find({ queryKey: ["results-summary", "ws-1"] })?.state.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryCache().find({ queryKey: ["datasets", "list"] })?.state.isInvalidated,
    ).not.toBe(true);
  });
});
