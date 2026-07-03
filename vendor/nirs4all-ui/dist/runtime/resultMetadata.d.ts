export type RuntimeDiagnosticTone = "error" | "warning" | "info";
/**
 * One normalized runtime diagnostic. Mirrors the rt_error.v1 wire envelope
 * (`nirs4all-ecosystem/docs/contracts/runtime/rt_error.v1.schema.json`):
 * `verb` / `cause` / `message` / `mitigation` / `unsupported_capability` are
 * carried; `portable_level` is opaque (CAP-002) and never interpreted here.
 */
export interface RuntimeDiagnosticItem {
    id: string;
    verb: string | null;
    cause: string | null;
    message: string;
    mitigation: string | null;
    unsupportedCapability: string | null;
    tone: RuntimeDiagnosticTone;
}
export type RuntimeEngineTone = "default" | "success" | "warning" | "muted";
export interface RuntimeEngineStatusView {
    engine: string | null;
    engineLabel: string | null;
    requestedEngine: string | null;
    requestedEngineLabel: string | null;
    badgeLabel: string;
    detailLabel: string | null;
    isFallback: boolean;
    tone: RuntimeEngineTone;
    diagnostics: RuntimeDiagnosticItem[];
}
export interface RuntimeNativeResultsAffordanceInput {
    hasNativeResults?: boolean | null;
    artifactCount?: number | null;
    nativeArtifactCount?: number | null;
    hasRefit?: boolean | null;
    exportLabel?: string | null;
    exportDescription?: string | null;
    disabled?: boolean;
    disabledReason?: string | null;
}
export interface RuntimeNativeResultsAffordanceView {
    hasNativeResults: boolean;
    artifactCount: number | null;
    nativeResultsLabel: string;
    exportLabel: string;
    exportDescription: string | null;
    disabled: boolean;
    disabledReason: string | null;
}
export declare function normalizeRuntimeDiagnostics(source: unknown): RuntimeDiagnosticItem[];
export declare function formatRuntimeTokenLabel(value: string | null | undefined): string;
/**
 * Format a runtime refusal (an rt_error.v1 envelope normalized to a
 * `RuntimeDiagnosticItem`) as the shared multi-line message hosts show when a
 * strict-mode run is refused (banner, execution log, toast):
 *
 *   `<Verb> refused: <Cause>`
 *   `<message>`
 *   `Mitigation: <mitigation>`              (when present)
 *   `Missing capability: <Capability>`      (when present)
 */
export declare function formatRuntimeRefusalText(item: Pick<RuntimeDiagnosticItem, "verb" | "cause" | "message" | "mitigation" | "unsupportedCapability">): string;
export declare function buildRuntimeEngineStatus(source: unknown): RuntimeEngineStatusView | null;
export declare function formatRuntimeEngineTitle(status: RuntimeEngineStatusView | null | undefined): string | null;
export declare function buildRuntimeNativeResultsAffordance(input?: RuntimeNativeResultsAffordanceInput): RuntimeNativeResultsAffordanceView;
//# sourceMappingURL=resultMetadata.d.ts.map