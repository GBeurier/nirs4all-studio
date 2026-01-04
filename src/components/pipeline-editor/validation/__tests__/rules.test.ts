/**
 * Validation Rules Tests
 *
 * Tests for the validation rules configuration.
 */

import { describe, it, expect } from "vitest";
import {
  VALIDATION_RULES,
  getRuleByCode,
  getRulesByCategory,
  getDisableableRules,
  getDefaultEnabledRules,
  getRulesBySeverity,
  getEffectiveSeverity,
  CATEGORY_METADATA,
  SEVERITY_METADATA,
} from "../rules";
import type { ValidationErrorCode, ValidationSeverity, ValidationCategory } from "../types";

describe("VALIDATION_RULES", () => {
  it("should be an array of rules", () => {
    expect(Array.isArray(VALIDATION_RULES)).toBe(true);
    expect(VALIDATION_RULES.length).toBeGreaterThan(0);
  });

  it("should contain expected error codes", () => {
    const expectedCodes: ValidationErrorCode[] = [
      "PARAM_REQUIRED",
      "PARAM_TYPE_MISMATCH",
      "PARAM_OUT_OF_RANGE",
      "PARAM_INVALID_VALUE",
      "PIPELINE_EMPTY",
      "PIPELINE_NO_MODEL",
      "PIPELINE_MODEL_BEFORE_SPLITTER",
      "PIPELINE_MERGE_WITHOUT_BRANCH",
      "STEP_EMPTY_BRANCHES",
      "STEP_DUPLICATE_ID",
    ];

    for (const code of expectedCodes) {
      const rule = VALIDATION_RULES.find((r) => r.code === code);
      expect(rule, `Rule ${code} should exist`).toBeDefined();
    }
  });

  it("should have valid structure for each rule", () => {
    for (const rule of VALIDATION_RULES) {
      expect(rule.code).toBeDefined();
      expect(["error", "warning", "info"]).toContain(rule.severity);
      expect(rule.category).toBeDefined();
      expect(rule.name).toBeDefined();
      expect(rule.description).toBeDefined();
      expect(typeof rule.canDisable).toBe("boolean");
      expect(typeof rule.defaultEnabled).toBe("boolean");
    }
  });
});

describe("getRuleByCode", () => {
  it("should return rule for valid code", () => {
    const rule = getRuleByCode("PARAM_REQUIRED");

    expect(rule).toBeDefined();
    expect(rule?.code).toBe("PARAM_REQUIRED");
  });

  it("should return undefined for invalid code", () => {
    const rule = getRuleByCode("INVALID_CODE" as ValidationErrorCode);

    expect(rule).toBeUndefined();
  });
});

describe("getRulesByCategory", () => {
  it("should return parameter rules", () => {
    const rules = getRulesByCategory("parameter");

    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((rule) => {
      expect(rule.category).toBe("parameter");
    });
  });

  it("should return pipeline rules", () => {
    const rules = getRulesByCategory("pipeline");

    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((rule) => {
      expect(rule.category).toBe("pipeline");
    });
  });

  it("should return step rules", () => {
    const rules = getRulesByCategory("step");

    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((rule) => {
      expect(rule.category).toBe("step");
    });
  });

  it("should return empty array for non-existent category", () => {
    const rules = getRulesByCategory("nonexistent" as ValidationCategory);

    expect(rules).toEqual([]);
  });
});

describe("getDisableableRules", () => {
  it("should return only disableable rules", () => {
    const rules = getDisableableRules();

    rules.forEach((rule) => {
      expect(rule.canDisable).toBe(true);
    });
  });

  it("should not include non-disableable rules", () => {
    const disableable = getDisableableRules();
    const disableableCodes = new Set(disableable.map((r) => r.code));

    for (const rule of VALIDATION_RULES) {
      if (!rule.canDisable) {
        expect(disableableCodes.has(rule.code)).toBe(false);
      }
    }
  });
});

describe("getDefaultEnabledRules", () => {
  it("should return rules enabled by default", () => {
    const rules = getDefaultEnabledRules();

    rules.forEach((rule) => {
      expect(rule.defaultEnabled).toBe(true);
    });
  });
});

describe("getRulesBySeverity", () => {
  it("should return error rules", () => {
    const rules = getRulesBySeverity("error");

    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((rule) => {
      expect(rule.severity).toBe("error");
    });
  });

  it("should return warning rules", () => {
    const rules = getRulesBySeverity("warning");

    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((rule) => {
      expect(rule.severity).toBe("warning");
    });
  });

  it("should handle info rules", () => {
    const rules = getRulesBySeverity("info");

    // May or may not have info rules
    rules.forEach((rule) => {
      expect(rule.severity).toBe("info");
    });
  });
});

describe("getEffectiveSeverity", () => {
  it("should return rule severity for existing rule", () => {
    const rule = getRuleByCode("PARAM_REQUIRED");
    const severity = getEffectiveSeverity("PARAM_REQUIRED");

    expect(severity).toBe(rule?.severity);
  });

  it("should return a fallback for unknown rule", () => {
    const severity = getEffectiveSeverity("UNKNOWN_RULE" as ValidationErrorCode);

    // Implementation may return a default severity
    expect(["error", "warning", "info"]).toContain(severity);
  });
});

describe("CATEGORY_METADATA", () => {
  it("should have metadata for all categories", () => {
    const categories: ValidationCategory[] = [
      "parameter",
      "step",
      "pipeline",
      "dependency",
      "compatibility",
    ];

    for (const category of categories) {
      expect(CATEGORY_METADATA[category]).toBeDefined();
      expect(CATEGORY_METADATA[category].label).toBeDefined();
      expect(CATEGORY_METADATA[category].icon).toBeDefined();
    }
  });
});

describe("SEVERITY_METADATA", () => {
  it("should have metadata for all severities", () => {
    const severities: ValidationSeverity[] = ["error", "warning", "info"];

    for (const severity of severities) {
      expect(SEVERITY_METADATA[severity]).toBeDefined();
      expect(SEVERITY_METADATA[severity].label).toBeDefined();
      expect(SEVERITY_METADATA[severity].color).toBeDefined();
      expect(SEVERITY_METADATA[severity].icon).toBeDefined();
    }
  });
});
