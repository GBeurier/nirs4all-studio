/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import type { ParameterDefinition } from "@/data/nodes/types";
import type { PipelineStep } from "../../types";
import { validateParameter } from "../parameterValidator";
import { validatePipeline } from "../pipelineValidator";

const step = { id: "s1", name: "PLSRegression", type: "model", params: {} } as unknown as PipelineStep;
const definition = { name: "n_components", label: "Components", type: "int", required: true, min: 1 } as unknown as ParameterDefinition;

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("validation messages follow the UI language", () => {
  it("produces English messages in English", async () => {
    await i18n.changeLanguage("en");
    const [issue] = validateParameter("n_components", undefined, definition, step);
    expect(issue.code).toBe("PARAM_REQUIRED");
    expect(issue.message).toBe('Parameter "Components" is required');
  });

  it("produces French messages in French while keeping codes untouched", async () => {
    await i18n.changeLanguage("fr");
    const [issue] = validateParameter("n_components", undefined, definition, step);
    expect(issue.code).toBe("PARAM_REQUIRED");
    expect(issue.message).toBe("Le paramètre « Components » est obligatoire");
  });

  it("localizes pipeline structure issues and plurals", async () => {
    await i18n.changeLanguage("fr");
    const [issue] = validatePipeline({ steps: [] });
    expect(issue.code).toBe("PIPELINE_EMPTY");
    expect(issue.message).toBe("Le pipeline ne contient aucune étape");

    const tooLow = validateParameter(
      "n_components",
      0,
      { ...definition, type: "string", minLength: 1 } as unknown as ParameterDefinition,
      step,
    );
    expect(tooLow[0]?.code).toBeDefined();
  });
});
