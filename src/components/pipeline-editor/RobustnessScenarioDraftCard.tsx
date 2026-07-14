import { useMemo, useState, type ChangeEvent } from "react";
import { Activity } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  getRobustnessModeOptionsFromRegistry,
  getRobustnessScenarioDistributionOptionsFromRegistry,
  getRobustnessScenarioKindOptionsFromRegistry,
  isRobustnessExecutableMode,
  validateRobustnessScenarioDraft,
  type RobustnessExecutableMode,
  type RobustnessModeOption,
  type RobustnessScenarioDraft,
  type RobustnessScenarioDistributionOption,
  type RobustnessScenarioKindOption,
} from "@/ui/robustness";
import type { KeywordRegistryDocument } from "@/ui/keywordRegistry";
import type {
  PipelineExecutionRobustnessEvidencePublicationPayload,
  PipelineExecutionRobustnessSpectralReplayEvidencePayload,
} from "@/lib/pipelineExecutionContract";

export interface RobustnessScenarioDraftCardProps {
  attachToLaunch?: boolean;
  disabled?: boolean;
  mode?: string;
  onAttachToLaunchChange?: (attach: boolean) => void;
  onModeChange?: (mode: string) => void;
  onPublishSpectralEvidenceChange?: (publish: boolean) => void;
  publishSpectralEvidence?: boolean;
  registry?: KeywordRegistryDocument | null;
  value?: RobustnessScenarioDraft;
  onChange?: (draft: RobustnessScenarioDraft) => void;
}

export interface RobustnessScenarioDraftViewModel {
  distributionOptions: RobustnessScenarioDistributionOption[];
  issues: ReturnType<typeof validateRobustnessScenarioDraft>;
  kindOptions: RobustnessScenarioKindOption[];
  modeExecutable: boolean;
  modeOptions: RobustnessModeOption[];
  normalizedMode: RobustnessExecutableMode | null;
  normalizedDraft: Record<string, unknown>;
  registrySource: "fallback" | "registry";
  valid: boolean;
}

export const DEFAULT_ROBUSTNESS_MODE: RobustnessExecutableMode = "clean_frozen";

export const DEFAULT_ROBUSTNESS_SCENARIO_DRAFT: RobustnessScenarioDraft = {
  kind: "observed",
  severity: 0,
};

export const ROBUSTNESS_SPECTRAL_REPLAY_PUBLICATION_PAYLOAD: PipelineExecutionRobustnessSpectralReplayEvidencePayload = {
  X: "dataset_partition",
  predictor_bundle: "exported_model_bundle",
  destination: "result_metadata.robustness_evidence",
  fail_closed: true,
};

export const ROBUSTNESS_EVIDENCE_PUBLICATION_PAYLOAD: PipelineExecutionRobustnessEvidencePublicationPayload = {
  spectral_replay: ROBUSTNESS_SPECTRAL_REPLAY_PUBLICATION_PAYLOAD,
};

function numberValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeRobustnessScenarioDraft(draft: RobustnessScenarioDraft): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  if (typeof draft.kind === "string" && draft.kind.length > 0) {
    normalized.kind = draft.kind;
  }
  if (typeof draft.severity === "number" && Number.isFinite(draft.severity)) {
    normalized.severity = draft.severity;
  }
  if (typeof draft.distribution === "string" && draft.distribution.length > 0) {
    normalized.distribution = draft.distribution;
  }

  return normalized;
}

export function buildRobustnessScenarioDraftViewModel(
  registry: KeywordRegistryDocument | null | undefined,
  draft: RobustnessScenarioDraft,
  mode: string = DEFAULT_ROBUSTNESS_MODE,
): RobustnessScenarioDraftViewModel {
  const modeOptions = getRobustnessModeOptionsFromRegistry(registry);
  const modeExecutable = modeOptions.some((option) => (
    option.value === mode && option.executable && !option.disabled
  )) && isRobustnessExecutableMode(mode);
  const kindOptions = getRobustnessScenarioKindOptionsFromRegistry(registry);
  const distributionOptions = getRobustnessScenarioDistributionOptionsFromRegistry(registry, draft.kind);
  const issues = validateRobustnessScenarioDraft(draft);

  return {
    distributionOptions,
    issues,
    kindOptions,
    modeExecutable,
    modeOptions,
    normalizedMode: modeExecutable ? mode : null,
    normalizedDraft: normalizeRobustnessScenarioDraft(draft),
    registrySource: registry ? "registry" : "fallback",
    valid: issues.length === 0 && modeExecutable,
  };
}

export function RobustnessScenarioDraftCard({
  attachToLaunch = false,
  disabled = false,
  mode = DEFAULT_ROBUSTNESS_MODE,
  onAttachToLaunchChange,
  onModeChange,
  onPublishSpectralEvidenceChange,
  publishSpectralEvidence = false,
  registry,
  value,
  onChange,
}: RobustnessScenarioDraftCardProps) {
  const [localDraft, setLocalDraft] = useState<RobustnessScenarioDraft>(DEFAULT_ROBUSTNESS_SCENARIO_DRAFT);
  const draft = value ?? localDraft;
  const viewModel = useMemo(
    () => buildRobustnessScenarioDraftViewModel(registry, draft, mode),
    [draft, mode, registry],
  );

  const commitDraft = (nextDraft: RobustnessScenarioDraft) => {
    if (value === undefined) {
      setLocalDraft(nextDraft);
    }
    onChange?.(nextDraft);
  };

  const handleKindChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const kind = event.target.value;
    const distributionOptions = getRobustnessScenarioDistributionOptionsFromRegistry(registry, kind);
    const distributionAllowed = distributionOptions.some(
      (option) => !option.disabled && option.value === draft.distribution,
    );
    const nextDraft: RobustnessScenarioDraft = {
      ...draft,
      kind,
    };

    if (!distributionAllowed) {
      delete nextDraft.distribution;
    }

    commitDraft(nextDraft);
  };

  const handleSeverityChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    const nextDraft: RobustnessScenarioDraft = { ...draft };

    if (rawValue === "") {
      delete nextDraft.severity;
    } else {
      nextDraft.severity = Number(rawValue);
    }

    commitDraft(nextDraft);
  };

  const handleDistributionChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextDraft: RobustnessScenarioDraft = { ...draft };
    const distribution = event.target.value;

    if (distribution === "") {
      delete nextDraft.distribution;
    } else {
      nextDraft.distribution = distribution;
    }

    commitDraft(nextDraft);
  };

  const distributionEnabled = viewModel.distributionOptions.some((option) => !option.disabled);
  const normalizedLaunchPayload = {
    mode: viewModel.normalizedMode ?? mode,
    scenarios: [viewModel.normalizedDraft],
    ...(attachToLaunch && publishSpectralEvidence ? { publish_evidence: ROBUSTNESS_EVIDENCE_PUBLICATION_PAYLOAD } : {}),
  };
  const canPublishSpectralEvidence = attachToLaunch && viewModel.valid && !disabled;

  return (
    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-sky-500" />
            Robustness scenario draft
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Compose one audit scenario with the native nirs4all vocabulary. This preview is not sent to the run yet.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant="outline" className="text-[10px]">
            registry {viewModel.registrySource}
          </Badge>
          <Badge variant={viewModel.valid ? "outline" : "destructive"} className="text-[10px]">
            {viewModel.valid ? "valid draft" : "invalid draft"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="space-y-1.5 text-xs">
          <span className="font-medium text-foreground">Mode</span>
          <select
            aria-label="Robustness mode"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            disabled={disabled}
            name="mode"
            value={mode}
            onChange={(event) => onModeChange?.(event.target.value)}
          >
            {viewModel.modeOptions.map((option) => (
              <option disabled={option.disabled} key={option.value} value={option.value}>
                {option.label}{option.executable ? "" : " (reserved)"}
              </option>
            ))}
          </select>
          {!viewModel.modeExecutable && (
            <p className="text-[10px] text-muted-foreground">
              Reserved mode: visible in the vocabulary, but not executable by Studio yet.
            </p>
          )}
        </label>

        <label className="space-y-1.5 text-xs">
          <span className="font-medium text-foreground">Scenario kind</span>
          <select
            aria-label="Robustness scenario kind"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            disabled={disabled}
            name="kind"
            value={stringValue(draft.kind)}
            onChange={handleKindChange}
          >
            {viewModel.kindOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5 text-xs">
          <span className="font-medium text-foreground">Severity</span>
          <input
            aria-label="Robustness scenario severity"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            disabled={disabled}
            min="0"
            name="severity"
            step="0.05"
            type="number"
            value={numberValue(draft.severity)}
            onChange={handleSeverityChange}
          />
        </label>

        <label className="space-y-1.5 text-xs">
          <span className="font-medium text-foreground">Distribution</span>
          <select
            aria-label="Robustness scenario distribution"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60"
            disabled={disabled || !distributionEnabled}
            name="distribution"
            value={stringValue(draft.distribution)}
            onChange={handleDistributionChange}
          >
            <option value="">none</option>
            {viewModel.distributionOptions.map((option) => (
              <option disabled={option.disabled} key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex items-start gap-2 rounded border border-border/50 bg-background/60 p-2 text-[11px]">
        <input
          aria-label="Attach robustness scenario draft to launch metadata"
          checked={attachToLaunch}
          className="mt-0.5"
          disabled={disabled || !viewModel.valid}
          type="checkbox"
          onChange={(event) => onAttachToLaunchChange?.(event.target.checked)}
        />
        <span>
          Attach this draft to launch metadata as <code>robustness.mode</code> and <code>robustness.scenarios</code>. This transports the native
          robustness plan for downstream execution drivers, but still does not compute a report in Studio.
        </span>
      </label>

      <label className="mt-2 flex items-start gap-2 rounded border border-border/50 bg-background/60 p-2 text-[11px]">
        <input
          aria-label="Publish spectral/OOD replay evidence when available"
          checked={attachToLaunch && publishSpectralEvidence}
          className="mt-0.5"
          disabled={!canPublishSpectralEvidence}
          type="checkbox"
          onChange={(event) => onPublishSpectralEvidenceChange?.(event.target.checked)}
        />
        <span>
          Publish spectral/OOD replay evidence when the execution driver can provide it: row-aligned <code>X</code> from
          the selected dataset partition and the exported predictor bundle path under <code>result_metadata.robustness_evidence</code>.
          This is fail-closed metadata publication, not a Studio-side recomputation.
        </span>
      </label>

      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1.2fr]">
        <div className="rounded border border-border/50 bg-background/60 p-2 text-[11px]">
          <p className="font-medium text-foreground">Effects</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
            <li>Audit-only diagnostic; it does not create a conformal guarantee.</li>
            <li>Only executable modes can be attached; reserved modes stay visible but disabled.</li>
            <li>Distribution is accepted only for stochastic perturbations.</li>
            <li>Evidence publication asks native drivers to persist replay inputs; Studio does not synthesize them.</li>
            <li>Native execution support remains controlled by `robustness.mode` and backend capabilities.</li>
          </ul>
        </div>

        <div className="rounded border border-border/50 bg-background/60 p-2">
          <p className="text-[11px] font-medium text-foreground">Normalized launch payload</p>
          <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted p-2 text-[10px] text-muted-foreground">
            {JSON.stringify(normalizedLaunchPayload, null, 2)}
          </pre>
        </div>
      </div>

      {viewModel.issues.length > 0 && (
        <div className="mt-3 rounded border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive">
          {viewModel.issues.map((issue) => (
            <p key={`${issue.path}-${issue.code}`}>{issue.message}</p>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Studio validates vocabulary and shape here, but does not perturb spectra or recompute metrics. Report execution
        remains owned by nirs4all robustness APIs.
      </p>
    </div>
  );
}
