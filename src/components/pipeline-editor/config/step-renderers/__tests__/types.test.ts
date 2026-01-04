/**
 * Step Renderer Types Tests
 *
 * Tests for type interfaces and utility types used by step renderers.
 * These tests verify the structure and compatibility of the interfaces.
 */

import { describe, it, expect, vi } from "vitest";
import type { PipelineStep, StepType } from "../../../types";
import type {
  StepRendererProps,
  ParameterRendererProps,
  UseStepRendererResult,
} from "../types";

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockStep(overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "test-step-1",
    name: "TestAlgorithm",
    type: "preprocessing" as StepType,
    enabled: true,
    params: { test_param: 10 },
    ...overrides,
  };
}

function createStepRendererProps(
  overrides: Partial<StepRendererProps> = {}
): StepRendererProps {
  return {
    step: createMockStep(),
    onUpdate: vi.fn(),
    onRemove: vi.fn(),
    onDuplicate: vi.fn(),
    ...overrides,
  };
}

function createParameterRendererProps(
  overrides: Partial<ParameterRendererProps> = {}
): ParameterRendererProps {
  return {
    ...createStepRendererProps(),
    renderParamInput: vi.fn(),
    handleNameChange: vi.fn(),
    handleResetParams: vi.fn(),
    ...overrides,
  };
}

// ============================================================================
// StepRendererProps Tests
// ============================================================================

describe("StepRendererProps interface", () => {
  describe("required properties", () => {
    it("should have step property", () => {
      const props = createStepRendererProps();
      expect(props.step).toBeDefined();
      expect(props.step.id).toBe("test-step-1");
    });

    it("should have onUpdate callback", () => {
      const props = createStepRendererProps();
      expect(typeof props.onUpdate).toBe("function");
    });

    it("should have onRemove callback", () => {
      const props = createStepRendererProps();
      expect(typeof props.onRemove).toBe("function");
    });

    it("should have onDuplicate callback", () => {
      const props = createStepRendererProps();
      expect(typeof props.onDuplicate).toBe("function");
    });
  });

  describe("optional properties", () => {
    it("should accept onSelectStep callback", () => {
      const onSelectStep = vi.fn();
      const props = createStepRendererProps({ onSelectStep });
      expect(props.onSelectStep).toBe(onSelectStep);
    });

    it("should accept onAddChild callback", () => {
      const onAddChild = vi.fn();
      const props = createStepRendererProps({ onAddChild });
      expect(props.onAddChild).toBe(onAddChild);
    });

    it("should accept onRemoveChild callback", () => {
      const onRemoveChild = vi.fn();
      const props = createStepRendererProps({ onRemoveChild });
      expect(props.onRemoveChild).toBe(onRemoveChild);
    });

    it("should accept currentOption", () => {
      const props = createStepRendererProps({
        currentOption: {
          name: "TestAlgo",
          description: "Test description",
          category: "test",
          defaultParams: {},
        },
      });
      expect(props.currentOption?.name).toBe("TestAlgo");
    });
  });

  describe("callback signatures", () => {
    it("onUpdate should accept id and partial step", () => {
      const onUpdate = vi.fn();
      const props = createStepRendererProps({ onUpdate });

      props.onUpdate("step-1", { name: "NewName" });
      expect(onUpdate).toHaveBeenCalledWith("step-1", { name: "NewName" });
    });

    it("onRemove should accept id", () => {
      const onRemove = vi.fn();
      const props = createStepRendererProps({ onRemove });

      props.onRemove("step-1");
      expect(onRemove).toHaveBeenCalledWith("step-1");
    });

    it("onDuplicate should accept id", () => {
      const onDuplicate = vi.fn();
      const props = createStepRendererProps({ onDuplicate });

      props.onDuplicate("step-1");
      expect(onDuplicate).toHaveBeenCalledWith("step-1");
    });

    it("onSelectStep should accept id or null", () => {
      const onSelectStep = vi.fn();
      const props = createStepRendererProps({ onSelectStep });

      props.onSelectStep?.("step-1");
      expect(onSelectStep).toHaveBeenCalledWith("step-1");

      props.onSelectStep?.(null);
      expect(onSelectStep).toHaveBeenCalledWith(null);
    });

    it("onAddChild should accept stepId", () => {
      const onAddChild = vi.fn();
      const props = createStepRendererProps({ onAddChild });

      props.onAddChild?.("container-1");
      expect(onAddChild).toHaveBeenCalledWith("container-1");
    });

    it("onRemoveChild should accept stepId and childId", () => {
      const onRemoveChild = vi.fn();
      const props = createStepRendererProps({ onRemoveChild });

      props.onRemoveChild?.("container-1", "child-1");
      expect(onRemoveChild).toHaveBeenCalledWith("container-1", "child-1");
    });
  });
});

// ============================================================================
// ParameterRendererProps Tests
// ============================================================================

describe("ParameterRendererProps interface", () => {
  describe("extends StepRendererProps", () => {
    it("should have all StepRendererProps properties", () => {
      const props = createParameterRendererProps();

      // From StepRendererProps
      expect(props.step).toBeDefined();
      expect(props.onUpdate).toBeDefined();
      expect(props.onRemove).toBeDefined();
      expect(props.onDuplicate).toBeDefined();
    });
  });

  describe("additional required properties", () => {
    it("should have renderParamInput callback", () => {
      const props = createParameterRendererProps();
      expect(typeof props.renderParamInput).toBe("function");
    });

    it("should have handleNameChange callback", () => {
      const props = createParameterRendererProps();
      expect(typeof props.handleNameChange).toBe("function");
    });

    it("should have handleResetParams callback", () => {
      const props = createParameterRendererProps();
      expect(typeof props.handleResetParams).toBe("function");
    });
  });

  describe("callback signatures", () => {
    it("renderParamInput should accept key and value", () => {
      const renderParamInput = vi.fn().mockReturnValue(null);
      const props = createParameterRendererProps({ renderParamInput });

      props.renderParamInput("n_components", 10);
      expect(renderParamInput).toHaveBeenCalledWith("n_components", 10);
    });

    it("renderParamInput should accept string values", () => {
      const renderParamInput = vi.fn().mockReturnValue(null);
      const props = createParameterRendererProps({ renderParamInput });

      props.renderParamInput("kernel", "rbf");
      expect(renderParamInput).toHaveBeenCalledWith("kernel", "rbf");
    });

    it("renderParamInput should accept boolean values", () => {
      const renderParamInput = vi.fn().mockReturnValue(null);
      const props = createParameterRendererProps({ renderParamInput });

      props.renderParamInput("shuffle", true);
      expect(renderParamInput).toHaveBeenCalledWith("shuffle", true);
    });

    it("handleNameChange should accept name string", () => {
      const handleNameChange = vi.fn();
      const props = createParameterRendererProps({ handleNameChange });

      props.handleNameChange("PLSRegression");
      expect(handleNameChange).toHaveBeenCalledWith("PLSRegression");
    });

    it("handleResetParams should be callable without arguments", () => {
      const handleResetParams = vi.fn();
      const props = createParameterRendererProps({ handleResetParams });

      props.handleResetParams();
      expect(handleResetParams).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// UseStepRendererResult Tests
// ============================================================================

describe("UseStepRendererResult interface", () => {
  function createMockResult(
    overrides: Partial<UseStepRendererResult> = {}
  ): UseStepRendererResult {
    return {
      Renderer: () => null,
      usesParameterProps: true,
      isLazy: false,
      ...overrides,
    };
  }

  describe("required properties", () => {
    it("should have Renderer property", () => {
      const result = createMockResult();
      expect(result.Renderer).toBeDefined();
      expect(typeof result.Renderer).toBe("function");
    });

    it("should have usesParameterProps boolean", () => {
      const result = createMockResult({ usesParameterProps: true });
      expect(typeof result.usesParameterProps).toBe("boolean");
    });

    it("should have isLazy boolean", () => {
      const result = createMockResult({ isLazy: false });
      expect(typeof result.isLazy).toBe("boolean");
    });
  });

  describe("property combinations", () => {
    it("should support non-lazy with parameter props", () => {
      const result = createMockResult({
        usesParameterProps: true,
        isLazy: false,
      });
      expect(result.usesParameterProps).toBe(true);
      expect(result.isLazy).toBe(false);
    });

    it("should support lazy with parameter props", () => {
      const result = createMockResult({
        usesParameterProps: true,
        isLazy: true,
      });
      expect(result.usesParameterProps).toBe(true);
      expect(result.isLazy).toBe(true);
    });

    it("should support lazy without parameter props", () => {
      const result = createMockResult({
        usesParameterProps: false,
        isLazy: true,
      });
      expect(result.usesParameterProps).toBe(false);
      expect(result.isLazy).toBe(true);
    });
  });
});
