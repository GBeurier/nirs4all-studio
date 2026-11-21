/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import "@/lib/i18n";
import type { ScoreCardRow } from "@/types/score-cards";
import { ScoreCardRowView } from "./ScoreCardRowView";

vi.mock("./ScoreCardRowActions", () => ({
  InlineScoreCardRowActions: () => null,
  TableScoreCardRowActions: () => null,
}));

const row: ScoreCardRow = {
  id: "prediction",
  chainId: "chain",
  modelName: "PLS",
  modelClass: "PLSRegression",
  preprocessings: null,
  cardType: "refit",
  bestParams: { n_components: 8 },
  metric: "rmse",
  testScores: {},
  valScores: {},
  trainScores: {},
  primaryTestScore: null,
  primaryValScore: 0.2,
  primaryTrainScore: null,
  hasRefitArtifact: true,
};

it.each(["inline", "table-row"] as const)("opens variant details from the model name in the %s view", async (variant) => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const rootElement = document.createElement("div");
  const root = createRoot(rootElement);
  const onViewDetails = vi.fn();
  const onToggleExpand = vi.fn();
  const scoreRow = (
    <ScoreCardRowView
      variant={variant}
      row={row}
      selectedMetrics={[]}
      expandable
      onViewDetails={onViewDetails}
      onToggleExpand={onToggleExpand}
    />
  );

  try {
    await act(async () => root.render(
      variant === "inline" ? scoreRow : <table><tbody>{scoreRow}</tbody></table>,
    ));
    expect(rootElement.textContent).not.toContain("n_components");
    const modelButton = [...rootElement.querySelectorAll("button")].find(button => button.textContent === "PLS");
    const foldsButton = rootElement.querySelector<HTMLButtonElement>("button[aria-expanded]");
    expect(modelButton).toBeDefined();
    expect(foldsButton).not.toBeNull();
    await act(async () => modelButton!.click());
    expect(onViewDetails).toHaveBeenCalledOnce();
    expect(onToggleExpand).not.toHaveBeenCalled();
    await act(async () => foldsButton!.click());
    expect(onToggleExpand).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});
