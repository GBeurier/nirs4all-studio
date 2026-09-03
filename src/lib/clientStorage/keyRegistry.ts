export type ClientStorageArea = "local" | "session";

export type ClientStorageScope = "user" | "workspace" | "session" | "runtime";

export interface ClientStorageKey<TValue = unknown> {
  readonly area: ClientStorageArea;
  readonly key: string;
  readonly scope: ClientStorageScope;
  readonly version: number;
  readonly description: string;
}

export function defineClientStorageKey<TValue>(
  key: string,
  options: {
    area: ClientStorageArea;
    scope: ClientStorageScope;
    version?: number;
    description: string;
  },
): ClientStorageKey<TValue> {
  return {
    area: options.area,
    key,
    scope: options.scope,
    version: options.version ?? 1,
    description: options.description,
  };
}

export const clientStorageKeys = {
  telemetryConsent: defineClientStorageKey<"accepted" | "declined" | "unset">(
    "nirs4all-telemetry-consent",
    {
      area: "local",
      scope: "user",
      description: "Cached telemetry consent status for web mode and Electron fallback reads.",
    },
  ),
  telemetryConsentDecidedAt: defineClientStorageKey<string>(
    "nirs4all-telemetry-consent-decided-at",
    {
      area: "local",
      scope: "user",
      description: "Timestamp for the most recent explicit telemetry consent decision.",
    },
  ),
  languagePreference: defineClientStorageKey<string>("nirs4all-language", {
    area: "local",
    scope: "user",
    description: "Language preference fallback when workspace settings are unavailable.",
  }),
  uiDensity: defineClientStorageKey<string>("nirs4all-ui-density", {
    area: "local",
    scope: "user",
    description: "UI density preference fallback when workspace settings are unavailable.",
  }),
  reduceAnimations: defineClientStorageKey<string>("nirs4all-reduce-animations", {
    area: "local",
    scope: "user",
    description: "Reduced-animation preference fallback when workspace settings are unavailable.",
  }),
  uiZoom: defineClientStorageKey<string>("nirs4all-ui-zoom", {
    area: "local",
    scope: "user",
    description: "UI zoom preference fallback when workspace settings are unavailable.",
  }),
  pipelineOperatorAvailability: defineClientStorageKey<unknown>(
    "pipelineEditor.operatorAvailability.v2",
    {
      area: "local",
      scope: "runtime",
      version: 2,
      description: "Cached operator availability response used to gate pipeline editor nodes.",
    },
  ),
  pipelineEditorExtendedMode: defineClientStorageKey<string>(
    "pipelineEditor.extendedMode",
    {
      area: "local",
      scope: "user",
      description: "Legacy pipeline editor extended-mode preference kept for compatibility.",
    },
  ),
  pipelineEditorTierLevel: defineClientStorageKey<string>(
    "pipelineEditor.tierLevel",
    {
      area: "local",
      scope: "user",
      description: "Pipeline editor operator tier preference.",
    },
  ),
  pipelineEditorShowUnavailableOperators: defineClientStorageKey<string>(
    "pipelineEditor.showUnavailableOperators",
    {
      area: "local",
      scope: "user",
      description: "Pipeline editor preference controlling unavailable operator visibility.",
    },
  ),
  customNodes: defineClientStorageKey<string>("nirs4all_custom_nodes", {
    area: "local",
    scope: "user",
    description: "Raw JSON custom node definitions persisted for local custom nodes.",
  }),
  customNodesVersion: defineClientStorageKey<string>("nirs4all_custom_nodes_version", {
    area: "local",
    scope: "user",
    description: "Schema version for locally persisted custom node definitions.",
  }),
  customNodesSecurityConfig: defineClientStorageKey<string>("nirs4all_custom_nodes_security", {
    area: "local",
    scope: "user",
    description: "Raw JSON custom node security configuration persisted for local custom nodes.",
  }),
  customNodesUserPackages: defineClientStorageKey<string>("nirs4all_custom_nodes_packages", {
    area: "local",
    scope: "user",
    description: "Raw JSON user-defined custom node package allowlist.",
  }),
  datasetsSortField: defineClientStorageKey<string>("datasets_sortField", {
    area: "local",
    scope: "user",
    description: "Datasets page sort field preference.",
  }),
  datasetsSortDirection: defineClientStorageKey<string>("datasets_sortDirection", {
    area: "local",
    scope: "user",
    description: "Datasets page sort direction preference.",
  }),
  shapSession: defineClientStorageKey<string>("nirs4all_shap_session", {
    area: "session",
    scope: "session",
    description: "Cached SHAP session state for restoring variable-importance views within a browser session.",
  }),
  playgroundSpectraChartConfig: defineClientStorageKey<string>("playground-spectra-chart-config", {
    area: "session",
    scope: "session",
    description: "Spectra chart configuration persisted for the active browser session.",
  }),
  playgroundGlobalColorConfig: defineClientStorageKey<string>("nirs4all_global_color_config", {
    area: "session",
    scope: "session",
    description: "Global playground color configuration persisted for the active browser session.",
  }),
  playgroundPipelineState: defineClientStorageKey<unknown>("playground-pipeline-state", {
    area: "session",
    scope: "session",
    description: "Legacy playground pipeline state cleared so operators do not reappear implicitly.",
  }),
  playgroundPipelineExport: defineClientStorageKey<unknown>("playground-pipeline-export", {
    area: "session",
    scope: "session",
    description: "Pipeline export handoff from Playground to Pipeline Editor for the active browser session.",
  }),
  pipelineEditorExportToPlayground: defineClientStorageKey<unknown>("pipeline-editor-export-to-playground", {
    area: "session",
    scope: "session",
    description: "Pipeline export handoff from Pipeline Editor to Playground for the active browser session.",
  }),
  currentEditedPipeline: defineClientStorageKey<string>("current-edited-pipeline", {
    area: "session",
    scope: "session",
    description: "Current Pipeline Editor draft handoff consumed by New Experiment within the active browser session.",
  }),
  playgroundSessionState: defineClientStorageKey<unknown>("playground-session-state", {
    area: "session",
    scope: "session",
    description: "Playground dataset and view state persisted for the active browser session.",
  }),
  inspectorSessionState: defineClientStorageKey<string>("inspector-session-state", {
    area: "session",
    scope: "session",
    description: "Inspector source filter, grouping, score, partition, and layout state persisted for the active browser session.",
  }),
  predictionChartConfig: defineClientStorageKey<unknown>("predictionChartConfig", {
    area: "local",
    scope: "user",
    version: 2,
    description: "Prediction viewer chart configuration, including per-dataset coloration overrides.",
  }),
  playgroundRenderPreferences: defineClientStorageKey<unknown>("playground-render-preferences", {
    area: "local",
    scope: "user",
    description: "Playground render preference overrides.",
  }),
  playgroundOutliersState: defineClientStorageKey<unknown>("playground-outliers-state", {
    area: "session",
    scope: "session",
    description: "Manual playground outlier indices persisted for the active browser session.",
  }),
  inspectorColorConfig: defineClientStorageKey<unknown>("inspector-color-config", {
    area: "session",
    scope: "session",
    description: "Inspector color configuration persisted for the active browser session.",
  }),
  datasetsListCache: defineClientStorageKey<unknown>("n4a:cache:datasets:list", {
    area: "local",
    scope: "workspace",
    version: 2,
    description: "Datasets list cache used for instant cold-start rendering.",
  }),
  linkedWorkspacesCache: defineClientStorageKey<unknown>("n4a:cache:workspaces:linked", {
    area: "local",
    scope: "workspace",
    version: 2,
    description: "Linked workspaces cache used for instant cold-start rendering.",
  }),
  predictArchiveV2Selection: defineClientStorageKey<unknown>(
    "n4a:predict:archive-v2-selection",
    {
      area: "local",
      scope: "workspace",
      description:
        "Bounded Archive V2 prediction pointer; invalid or legacy values are cleared fail-closed.",
    },
  ),
} as const;

export const clientStorageKeyPrefixes = {
  datasetWorkspaceScores: "n4a:cache:workspaces:",
  metricSelection: "metrics-",
  pipelineEditorDraft: "nirs4all_pipeline_editor_",
} as const;

export function datasetScoresCacheKey(workspaceId: string): ClientStorageKey<unknown> {
  return defineClientStorageKey<unknown>(
    `${clientStorageKeyPrefixes.datasetWorkspaceScores}${workspaceId}:scores`,
    {
      area: "local",
      scope: "workspace",
      version: 2,
      description: "Workspace-specific dataset score cache used for instant cold-start rendering.",
    },
  );
}

export function metricSelectionStorageKey(
  storageKey: string,
  storageVersion?: string,
): ClientStorageKey<string[]> {
  const legacyStorageKey = `${clientStorageKeyPrefixes.metricSelection}${storageKey}`;
  return defineClientStorageKey<string[]>(
    storageVersion ? `${legacyStorageKey}-${storageVersion}` : legacyStorageKey,
    {
      area: "local",
      scope: "user",
      description: "Metric selection preference for score/result pages.",
    },
  );
}

export function pipelineEditorDraftStorageKey(pipelineId: string): ClientStorageKey<string> {
  return defineClientStorageKey<string>(
    `${clientStorageKeyPrefixes.pipelineEditorDraft}${pipelineId}`,
    {
      area: "local",
      scope: "workspace",
      description: "Raw JSON pipeline editor draft persisted for an editable pipeline.",
    },
  );
}

export function legacyMetricSelectionStorageKey(storageKey: string): ClientStorageKey<string[]> {
  return defineClientStorageKey<string[]>(
    `${clientStorageKeyPrefixes.metricSelection}${storageKey}`,
    {
      area: "local",
      scope: "user",
      description: "Legacy metric selection preference key used during versioned migrations.",
    },
  );
}

export function themePreferenceStorageKey(storageKey: string): ClientStorageKey<string> {
  return defineClientStorageKey<string>(storageKey, {
    area: "local",
    scope: "user",
    description: "Theme preference fallback when workspace settings are unavailable.",
  });
}

export function listClientStorageKeys(): ClientStorageKey[] {
  return Object.values(clientStorageKeys);
}
