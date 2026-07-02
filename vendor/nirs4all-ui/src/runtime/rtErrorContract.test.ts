/**
 * Runtime-contract tests: pins how the shared runtime foundation consumes the
 * neutral rt_error.v1 wire envelope.
 *
 * The envelope is frozen by
 * `nirs4all-ecosystem/docs/contracts/runtime/rt_error.v1.schema.json`
 * (LOCK-RT / RT-003, B-018): required `verb`/`cause`/`message`, optional
 * `mitigation`/`unsupported_capability`/`portable_level`, and closed verb and
 * cause vocabularies. The fixtures below mirror that schema; if the schema
 * moves, these fixtures (and both host mirrors: Studio result payloads and the
 * Web `src/engine/rt.ts` module) must move together.
 */
import { describe, expect, it } from "vitest";

import {
  formatRuntimeRefusalText,
  normalizeRuntimeDiagnostics,
  type RuntimeDiagnosticItem,
} from "./resultMetadata.js";

/** Mirrors `rt_error.v1.schema.json#/properties/verb/enum`. */
const RT_VERBS = ["inspect", "validate", "plan", "run", "predict", "replay", "explain", "export"] as const;

/** Mirrors `rt_error.v1.schema.json#/properties/cause/enum`. */
const RT_ERROR_CAUSES = [
  "unsupported_shape",
  "unsupported_capability",
  "unavailable_backend",
  "invalid_request",
  "runtime_error",
] as const;

/** Mirrors the full wire key set (`additionalProperties: false`). */
const RT_ERROR_WIRE_KEYS = [
  "verb",
  "cause",
  "message",
  "mitigation",
  "unsupported_capability",
  "portable_level",
] as const;

const FULL_WIRE_ENVELOPE = {
  verb: "run",
  cause: "unsupported_capability",
  message: "dag-ml refused the schedule",
  mitigation: "Simplify the graph to model-only.",
  unsupported_capability: "cancellable_background_compute",
  portable_level: "L2",
} satisfies Record<typeof RT_ERROR_WIRE_KEYS[number], string>;

function firstDiagnostic(source: unknown): RuntimeDiagnosticItem {
  const [item] = normalizeRuntimeDiagnostics(source);
  if (!item) throw new Error("expected at least one normalized diagnostic");
  return item;
}

describe("rt_error.v1 runtime contract", () => {
  it("normalizes every interpreted wire key of a full envelope", () => {
    const item = firstDiagnostic([FULL_WIRE_ENVELOPE]);

    expect(item).toMatchObject({
      verb: "run",
      cause: "unsupported_capability",
      message: "dag-ml refused the schedule",
      mitigation: "Simplify the graph to model-only.",
      unsupportedCapability: "cancellable_background_compute",
      tone: "warning",
    });
    // `portable_level` is opaque (CAP-002): carried on the wire, never
    // interpreted or surfaced by the display foundation (DEC-RT-001).
    expect(Object.keys(item)).not.toContain("portableLevel");
    expect(Object.keys(item)).not.toContain("portable_level");
  });

  it("normalizes a minimal envelope (required keys only) for every verb", () => {
    for (const verb of RT_VERBS) {
      const item = firstDiagnostic([{ verb, cause: "runtime_error", message: "boom" }]);
      expect(item).toMatchObject({
        verb,
        cause: "runtime_error",
        message: "boom",
        mitigation: null,
        unsupportedCapability: null,
      });
    }
  });

  it("maps the closed cause vocabulary onto display tones", () => {
    const toneByCause: Record<typeof RT_ERROR_CAUSES[number], RuntimeDiagnosticItem["tone"]> = {
      unsupported_shape: "warning",
      unsupported_capability: "warning",
      unavailable_backend: "warning",
      invalid_request: "info",
      runtime_error: "info",
    };

    for (const cause of RT_ERROR_CAUSES) {
      expect(firstDiagnostic([{ verb: "run", cause, message: "x" }]).tone).toBe(toneByCause[cause]);
    }

    // An explicit severity always escalates over the cause heuristic.
    expect(firstDiagnostic([
      { verb: "run", cause: "invalid_request", message: "x", severity: "error" },
    ]).tone).toBe("error");
  });

  it("formats a full refusal as the shared multi-line host message", () => {
    expect(formatRuntimeRefusalText(firstDiagnostic([FULL_WIRE_ENVELOPE]))).toBe([
      "Run refused: Unsupported Capability",
      "dag-ml refused the schedule",
      "Mitigation: Simplify the graph to model-only.",
      "Missing capability: Cancellable Background Compute",
    ].join("\n"));
  });

  it("formats a minimal refusal without optional lines", () => {
    expect(formatRuntimeRefusalText(firstDiagnostic([
      { verb: "predict", cause: "unavailable_backend", message: "wasm module missing" },
    ]))).toBe([
      "Predict refused: Unavailable Backend",
      "wasm module missing",
    ].join("\n"));
  });
});
