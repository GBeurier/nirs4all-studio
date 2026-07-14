import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface GuardedSourceFile {
  path: string;
  requiredImports: string[];
  requiredCopy?: string[];
}

const guardedSourceFiles: GuardedSourceFile[] = [
  {
    path: "src/components/results/resultDetailData.ts",
    requiredImports: ["@/ui/conformal", "@/ui/robustness", "@/ui/tuning"],
  },
  {
    path: "src/components/predictions/detail/useChainDetailPanelState.ts",
    requiredImports: ["@/ui/conformal", "@/ui/robustness", "@/ui/tuning"],
  },
  {
    path: "src/components/results/ResultMetricsConformalSummary.tsx",
    requiredImports: ["@/ui/conformal"],
    requiredCopy: [
      "Studio displays them without recomputing observed coverage or interval scores.",
    ],
  },
  {
    path: "src/components/results/ResultMetricsRobustnessSummary.tsx",
    requiredImports: ["@/ui/robustness"],
    requiredCopy: [
      "Studio does not recompute robustness metrics.",
      "Studio does not recompute slice metrics.",
    ],
  },
  {
    path: "src/components/results/ResultMetricsTuningSummary.tsx",
    requiredImports: ["@/ui/tuning"],
    requiredCopy: ["Native tuning"],
  },
];

const forbiddenScientificImplementations = [
  {
    label: "local conformal calibration or quantile implementation",
    pattern: /\b(?:quantile|percentile|qhat|calibrateConformal|fitConformal|conformalScore)\s*\(/iu,
  },
  {
    label: "local conformal metric recomputation",
    pattern: /\b(?:observedCoverage|coverageGap|meanIntervalScore|intervalScore)\s*\(/iu,
  },
  {
    label: "local robustness metric implementation",
    pattern: /\b(?:computeRmse|computeMae|rootMeanSquaredError|meanAbsoluteError|robustnessScore)\s*\(/iu,
  },
  {
    label: "numerical science math primitive in Studio boundary files",
    pattern: /\bMath\.(?:sqrt|pow|exp|log|random)\s*\(/u,
  },
  {
    label: "scientific library import in Studio boundary files",
    pattern: /\b(?:from|import)\s+["'](?:numpy|scipy|sklearn|statsmodels)["']/iu,
  },
  {
    label: "model fitting or probabilistic prediction in Studio UI",
    pattern: /\.(?:fit|fit_predict|predict_proba)\s*\(/iu,
  },
];

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("native result science boundary", () => {
  it("keeps Studio native conformal, robustness, and tuning surfaces on shared read-model adapters", () => {
    for (const file of guardedSourceFiles) {
      const source = readProjectFile(file.path);

      for (const importPath of file.requiredImports) {
        expect(source, `${file.path} must import ${importPath}`).toContain(`"${importPath}"`);
      }
    }
  });

  it("documents non-recomputation on user-facing native result surfaces", () => {
    for (const file of guardedSourceFiles) {
      const source = readProjectFile(file.path);

      for (const copy of file.requiredCopy ?? []) {
        expect(source, `${file.path} must keep native-boundary copy: ${copy}`).toContain(copy);
      }
    }
  });

  it("does not implement conformal calibration or robustness science inside Studio result surfaces", () => {
    for (const file of guardedSourceFiles) {
      const source = readProjectFile(file.path);

      for (const forbidden of forbiddenScientificImplementations) {
        expect(source, `${file.path} must not contain ${forbidden.label}`).not.toMatch(forbidden.pattern);
      }
    }
  });
});
