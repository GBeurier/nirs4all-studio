import { describe, expect, it } from "vitest";
import type { FinetuneConfig, PipelineParams, PipelineStep } from "../../../types";
import {
  FINETUNING_TAB_TONE_CLASS_NAME,
  MODEL_TAB_TRIGGER_CLASS_NAME,
  REFIT_TAB_TONE_CLASS_NAME,
  getFinetuningTabClassName,
  getFinetuningTrialBadgeLabel,
  getModelParameterState,
  getModelRendererViewState,
  getRefitBadgeLabel,
  getRefitTabClassName,
  hasFinetuning,
  hasRefit,
  isDeepLearningModel,
  shouldShowQuickFinetuningCta,
} from "../ModelRendererData";

function finetuneConfig(overrides: Partial<FinetuneConfig> = {}): FinetuneConfig {
  return {
    enabled: true,
    n_trials: 25,
    approach: "single",
    eval_mode: "best",
    model_params: [],
    ...overrides,
  };
}

function modelStepState(overrides: Partial<PipelineStep> = {}) {
  return {
    params: {},
    ...overrides,
  } as Pick<PipelineStep, "finetuneConfig" | "params" | "refitConfig">;
}

describe("model tab state helpers", () => {
  it("detects enabled finetuning and exposes the trial badge label", () => {
    const step = modelStepState({
      finetuneConfig: finetuneConfig({ n_trials: 40 }),
    });

    expect(hasFinetuning(step)).toBe(true);
    expect(getFinetuningTrialBadgeLabel(step)).toBe(40);
  });

  it("hides finetuning badge labels when finetuning is absent or disabled", () => {
    expect(hasFinetuning(modelStepState())).toBe(false);
    expect(
      getFinetuningTrialBadgeLabel(
        modelStepState({
          finetuneConfig: finetuneConfig({ enabled: false, n_trials: 40 }),
        }),
      ),
    ).toBeUndefined();
  });

  it("treats refit as enabled by default and clears its badge when disabled", () => {
    expect(hasRefit(modelStepState())).toBe(true);
    expect(getRefitBadgeLabel(modelStepState())).toBe("On");

    const disabledRefitStep = modelStepState({
      refitConfig: { enabled: false },
    });

    expect(hasRefit(disabledRefitStep)).toBe(false);
    expect(getRefitBadgeLabel(disabledRefitStep)).toBeUndefined();
  });

  it("detects deep-learning tab visibility from the selected option", () => {
    expect(isDeepLearningModel()).toBe(false);
    expect(isDeepLearningModel({ isDeepLearning: false })).toBe(false);
    expect(isDeepLearningModel({ isDeepLearning: true })).toBe(true);
  });
});

describe("model tab class helpers", () => {
  it("adds finetuning tone classes only when finetuning is enabled", () => {
    expect(getFinetuningTabClassName(false)).toBe(MODEL_TAB_TRIGGER_CLASS_NAME);
    expect(getFinetuningTabClassName(true)).toBe(
      `${MODEL_TAB_TRIGGER_CLASS_NAME} ${FINETUNING_TAB_TONE_CLASS_NAME}`,
    );
  });

  it("adds refit tone classes only when refit is enabled", () => {
    expect(getRefitTabClassName(false)).toBe(MODEL_TAB_TRIGGER_CLASS_NAME);
    expect(getRefitTabClassName(true)).toBe(
      `${MODEL_TAB_TRIGGER_CLASS_NAME} ${REFIT_TAB_TONE_CLASS_NAME}`,
    );
  });
});

describe("model parameter state helpers", () => {
  it("counts parameters and detects numeric values", () => {
    const params: PipelineParams = {
      alpha: 0.1,
      kernel: "rbf",
      normalize: false,
    };

    expect(getModelParameterState(params)).toEqual({
      parameterCount: 3,
      hasParameters: true,
      hasNumericParameters: true,
    });
  });

  it("marks an empty parameter list as empty and non-numeric", () => {
    expect(getModelParameterState({})).toEqual({
      parameterCount: 0,
      hasParameters: false,
      hasNumericParameters: false,
    });
  });

  it("shows the quick finetuning CTA only for numeric params without enabled finetuning", () => {
    expect(
      shouldShowQuickFinetuningCta({ hasNumericParameters: true }, false),
    ).toBe(true);
    expect(
      shouldShowQuickFinetuningCta({ hasNumericParameters: true }, true),
    ).toBe(false);
    expect(
      shouldShowQuickFinetuningCta({ hasNumericParameters: false }, false),
    ).toBe(false);
  });
});

describe("getModelRendererViewState", () => {
  it("combines tab, badge and parameter decisions for ModelRenderer", () => {
    const state = getModelRendererViewState(
      modelStepState({
        params: { max_depth: 4 },
        finetuneConfig: finetuneConfig({ n_trials: 12 }),
        refitConfig: { enabled: false },
      }),
      { isDeepLearning: true },
    );

    expect(state).toMatchObject({
      parameterCount: 1,
      hasParameters: true,
      hasNumericParameters: true,
      hasFinetuning: true,
      hasRefit: false,
      isDeepLearning: true,
      finetuningTrialBadgeLabel: 12,
      refitBadgeLabel: undefined,
      showQuickFinetuningCta: false,
    });
  });

  it("enables the quick finetuning CTA for numeric parameters when finetuning is off", () => {
    expect(
      getModelRendererViewState(
        modelStepState({
          params: { n_estimators: 100 },
        }),
      ).showQuickFinetuningCta,
    ).toBe(true);
  });
});
