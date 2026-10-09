import i18n from "i18next";

import {
  CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
  DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS,
  NATIVE_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
  WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
  type ExperimentExecutionAdapter,
  type ExperimentExecutionAdapterId,
  type SubmitClusterRun,
  type SubmitNativeLocalRun,
  type SubmitExperimentLaunchSubmissionOptions,
  type SubmitWasmLocalRun,
} from "./experimentExecutionAdapter";
import type {
  RunExecutionBackend,
  RunExecutionBackendCapability,
} from "@/types/runs";

export type NewExperimentNativeExecutionBackend = "cluster" | "wasm-local";

export type NewExperimentNativeBackendAvailabilityStatus =
  | "available"
  | "not_configured"
  | "backend_unavailable";

export type NewExperimentWorkspacePredictionPublicationStatus =
  | "publisher_configured"
  | "handoff_only"
  | "not_configured"
  | "backend_unavailable";

export interface NewExperimentNativeBackendAvailability {
  backend: NewExperimentNativeExecutionBackend;
  adapterId: ExperimentExecutionAdapterId;
  status: NewExperimentNativeBackendAvailabilityStatus;
  statusLabel: string;
  message: string;
}

export interface NewExperimentWorkspacePredictionPublicationAvailability {
  backend: NewExperimentNativeExecutionBackend;
  status: NewExperimentWorkspacePredictionPublicationStatus;
  statusLabel: string;
  destination: "result_metadata.robustness_evidence";
  message: string;
}

export interface NewExperimentExecutionEnvironmentDiagnostics {
  availableAdapterIds: ExperimentExecutionAdapterId[];
  availableExecutionBackends?: RunExecutionBackend[];
  configuredNativeBackends: NewExperimentNativeExecutionBackend[];
  unconfiguredNativeBackends: NewExperimentNativeExecutionBackend[];
  unavailableExecutionBackends?: RunExecutionBackend[];
  unavailableNativeBackends?: NewExperimentNativeExecutionBackend[];
  workspacePredictionPublisherBackends: NewExperimentNativeExecutionBackend[];
  workspacePredictionHandoffOnlyBackends: NewExperimentNativeExecutionBackend[];
  hasClusterSubmitter: boolean;
  hasWasmLocalSubmitter: boolean;
}

export interface NewExperimentExecutionEnvironment {
  availableExecutionAdapters: readonly ExperimentExecutionAdapter[];
  executionBackendCapabilities: readonly RunExecutionBackendCapability[];
  launchSubmitters: SubmitExperimentLaunchSubmissionOptions;
  nativeBackendAvailability: readonly NewExperimentNativeBackendAvailability[];
  workspacePredictionPublicationAvailability: readonly NewExperimentWorkspacePredictionPublicationAvailability[];
  diagnostics: NewExperimentExecutionEnvironmentDiagnostics;
}

export interface BuildNewExperimentExecutionEnvironmentOptions {
  executionBackendCapabilities?: readonly RunExecutionBackendCapability[];
  submitNativeLocalRun?: SubmitNativeLocalRun;
  submitClusterRun?: SubmitClusterRun;
  submitWasmLocalRun?: SubmitWasmLocalRun;
  workspacePredictionPublicationBackends?: readonly NewExperimentNativeExecutionBackend[];
}

function isExecutionEnvironmentOptionsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKnownExecutionBackend(value: unknown): value is RunExecutionBackend {
  return value === "local-python" || value === "cluster" || value === "wasm-local";
}

function isKnownNativeExecutionBackend(value: unknown): value is NewExperimentNativeExecutionBackend {
  return value === "cluster" || value === "wasm-local";
}

function normalizeExecutionBackendCapabilities(value: unknown): RunExecutionBackendCapability[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const capabilities = value.filter((candidate): candidate is RunExecutionBackendCapability => (
    isExecutionEnvironmentOptionsRecord(candidate)
    && isKnownExecutionBackend(candidate.backend)
    && typeof candidate.label === "string"
    && typeof candidate.available === "boolean"
    && typeof candidate.mode === "string"
    && typeof candidate.supports_progress === "boolean"
    && typeof candidate.supports_cancellation === "boolean"
  )).map((candidate) => ({
    backend: candidate.backend,
    label: candidate.label,
    available: candidate.available,
    mode: candidate.mode,
    supports_progress: candidate.supports_progress,
    supports_cancellation: candidate.supports_cancellation,
    metadata: isExecutionEnvironmentOptionsRecord(candidate.metadata) ? candidate.metadata : {},
  }));

  return capabilities.length > 0 ? capabilities : undefined;
}

function normalizeWorkspacePredictionPublicationBackends(
  value: unknown,
): NewExperimentNativeExecutionBackend[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const backends = Array.from(new Set(value.filter(isKnownNativeExecutionBackend)));
  return backends.length > 0 ? backends : undefined;
}

export function normalizeNewExperimentExecutionEnvironmentOptions(
  options: unknown,
): BuildNewExperimentExecutionEnvironmentOptions | undefined {
  if (!isExecutionEnvironmentOptionsRecord(options)) return undefined;

  const normalized: BuildNewExperimentExecutionEnvironmentOptions = {};
  const executionBackendCapabilities = normalizeExecutionBackendCapabilities(options.executionBackendCapabilities);
  const workspacePredictionPublicationBackends = normalizeWorkspacePredictionPublicationBackends(
    options.workspacePredictionPublicationBackends,
  );
  const submitClusterRun = options.submitClusterRun;
  const submitNativeLocalRun = options.submitNativeLocalRun;
  const submitWasmLocalRun = options.submitWasmLocalRun;

  if (executionBackendCapabilities) {
    normalized.executionBackendCapabilities = executionBackendCapabilities;
  }

  if (workspacePredictionPublicationBackends) {
    normalized.workspacePredictionPublicationBackends = workspacePredictionPublicationBackends;
  }

  if (typeof submitClusterRun === "function") {
    normalized.submitClusterRun = submitClusterRun as SubmitClusterRun;
  }
  if (typeof submitNativeLocalRun === "function") {
    normalized.submitNativeLocalRun = submitNativeLocalRun as SubmitNativeLocalRun;
  }

  if (typeof submitWasmLocalRun === "function") {
    normalized.submitWasmLocalRun = submitWasmLocalRun as SubmitWasmLocalRun;
  }

  return normalized.executionBackendCapabilities
    || normalized.workspacePredictionPublicationBackends
    || normalized.submitClusterRun
    || normalized.submitNativeLocalRun
    || normalized.submitWasmLocalRun
    ? normalized
    : undefined;
}

export const DEFAULT_NEW_EXPERIMENT_LAUNCH_SUBMITTERS: SubmitExperimentLaunchSubmissionOptions = {};
const WORKSPACE_PREDICTION_PUBLICATION_DESTINATION = "result_metadata.robustness_evidence" as const;

function getNativeBackendLabel(backend: NewExperimentNativeExecutionBackend): string {
  return i18n.t(backend === "cluster" ? "newExperiment.campaign.backend.cluster" : "newExperiment.campaign.backend.wasmLocal");
}

/** Caches a language-dependent default so repeated reads keep a stable identity until the language changes. */
function cacheByLanguage<T>(build: () => T): () => T {
  let cached: { language: string | undefined; value: T } | undefined;
  return () => {
    if (!cached || cached.language !== i18n.language) {
      cached = { language: i18n.language, value: build() };
    }
    return cached.value;
  };
}

const getDefaultNativeBackendAvailability = cacheByLanguage<readonly NewExperimentNativeBackendAvailability[]>(() => [
  {
    backend: "cluster",
    adapterId: CLUSTER_EXPERIMENT_EXECUTION_ADAPTER.id,
    status: "not_configured",
    statusLabel: i18n.t("common.notConfigured"),
    message: i18n.t("newExperiment.environment.messages.notConfiguredSubmitter", { backend: getNativeBackendLabel("cluster") }),
  },
  {
    backend: "wasm-local",
    adapterId: WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.id,
    status: "not_configured",
    statusLabel: i18n.t("common.notConfigured"),
    message: i18n.t("newExperiment.environment.messages.notConfiguredSubmitter", { backend: getNativeBackendLabel("wasm-local") }),
  },
]);

const getDefaultWorkspacePredictionPublicationAvailability = cacheByLanguage<
  readonly NewExperimentWorkspacePredictionPublicationAvailability[]
>(() => [
  {
    backend: "cluster",
    status: "not_configured",
    statusLabel: i18n.t("common.notConfigured"),
    destination: WORKSPACE_PREDICTION_PUBLICATION_DESTINATION,
    message: i18n.t("newExperiment.environment.messages.notConfiguredPublisher", { backend: getNativeBackendLabel("cluster") }),
  },
  {
    backend: "wasm-local",
    status: "not_configured",
    statusLabel: i18n.t("common.notConfigured"),
    destination: WORKSPACE_PREDICTION_PUBLICATION_DESTINATION,
    message: i18n.t("newExperiment.environment.messages.notConfiguredPersistentPublisher", { backend: getNativeBackendLabel("wasm-local") }),
  },
]);

export function buildNewExperimentExecutionEnvironmentDiagnostics(
  environment: Pick<
    NewExperimentExecutionEnvironment,
    | "availableExecutionAdapters"
    | "executionBackendCapabilities"
    | "launchSubmitters"
    | "nativeBackendAvailability"
    | "workspacePredictionPublicationAvailability"
  >,
): NewExperimentExecutionEnvironmentDiagnostics {
  return {
    availableAdapterIds: environment.availableExecutionAdapters.map((adapter) => adapter.id),
    availableExecutionBackends: environment.executionBackendCapabilities
      .filter((capability) => capability.available)
      .map((capability) => capability.backend),
    configuredNativeBackends: environment.nativeBackendAvailability
      .filter((availability) => availability.status === "available")
      .map((availability) => availability.backend),
    unconfiguredNativeBackends: environment.nativeBackendAvailability
      .filter((availability) => availability.status !== "available")
      .map((availability) => availability.backend),
    unavailableExecutionBackends: environment.executionBackendCapabilities
      .filter((capability) => !capability.available)
      .map((capability) => capability.backend),
    unavailableNativeBackends: environment.nativeBackendAvailability
      .filter((availability) => availability.status === "backend_unavailable")
      .map((availability) => availability.backend),
    workspacePredictionPublisherBackends: environment.workspacePredictionPublicationAvailability
      .filter((availability) => availability.status === "publisher_configured")
      .map((availability) => availability.backend),
    workspacePredictionHandoffOnlyBackends: environment.workspacePredictionPublicationAvailability
      .filter((availability) => availability.status === "handoff_only")
      .map((availability) => availability.backend),
    hasClusterSubmitter: Boolean(environment.launchSubmitters.submitClusterRun),
    hasWasmLocalSubmitter: Boolean(environment.launchSubmitters.submitWasmLocalRun),
  };
}

const getDefaultDiagnostics = cacheByLanguage(() => buildNewExperimentExecutionEnvironmentDiagnostics({
  availableExecutionAdapters: DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS,
  executionBackendCapabilities: [],
  launchSubmitters: DEFAULT_NEW_EXPERIMENT_LAUNCH_SUBMITTERS,
  nativeBackendAvailability: getDefaultNativeBackendAvailability(),
  workspacePredictionPublicationAvailability: getDefaultWorkspacePredictionPublicationAvailability(),
}));

/** Default environment; the localized availability messages are resolved lazily in the active language. */
export const DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT: NewExperimentExecutionEnvironment = {
  availableExecutionAdapters: DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS,
  executionBackendCapabilities: [],
  launchSubmitters: DEFAULT_NEW_EXPERIMENT_LAUNCH_SUBMITTERS,
  get nativeBackendAvailability() { return getDefaultNativeBackendAvailability(); },
  get workspacePredictionPublicationAvailability() { return getDefaultWorkspacePredictionPublicationAvailability(); },
  get diagnostics() { return getDefaultDiagnostics(); },
};

function appendAdapterIfMissing(
  adapters: ExperimentExecutionAdapter[],
  adapter: ExperimentExecutionAdapter,
): void {
  if (!adapters.some((candidate) => candidate.id === adapter.id)) {
    adapters.push(adapter);
  }
}

function getCapabilityByBackend(
  capabilities: readonly RunExecutionBackendCapability[],
  backend: RunExecutionBackend,
): RunExecutionBackendCapability | undefined {
  return capabilities.find((capability) => capability.backend === backend);
}

function getCapabilityMessage(
  capability: RunExecutionBackendCapability,
  fallback: string,
): string {
  const message = capability.metadata.message;
  if (typeof message === "string" && message.trim()) return message;

  const reason = capability.metadata.reason;
  if (typeof reason === "string" && reason.trim()) return reason;

  return fallback;
}

function capabilityDeclaresWorkspacePredictionPublisher(
  capability: RunExecutionBackendCapability | undefined,
): boolean {
  const publication = capability?.metadata.workspace_prediction_publication;
  if (typeof publication !== "object" || publication === null) return false;
  const payload = publication as Record<string, unknown>;
  return payload.status === "publisher_configured"
    && payload.destination === WORKSPACE_PREDICTION_PUBLICATION_DESTINATION;
}

function buildNativeBackendAvailabilityEntry({
  backend,
  adapterId,
  capability,
  hasSubmitter,
  configuredMessage,
  defaultMessage,
}: {
  backend: NewExperimentNativeExecutionBackend;
  adapterId: ExperimentExecutionAdapterId;
  capability?: RunExecutionBackendCapability;
  hasSubmitter: boolean;
  configuredMessage: string;
  defaultMessage: string;
}): NewExperimentNativeBackendAvailability {
  if (capability && !capability.available) {
    return {
      backend,
      adapterId,
      status: "backend_unavailable",
      statusLabel: i18n.t("newExperiment.environment.status.unavailable"),
      message: getCapabilityMessage(
        capability,
        i18n.t("newExperiment.environment.messages.noDriver", { label: capability.label }),
      ),
    };
  }

  if (hasSubmitter) {
    return {
      backend,
      adapterId,
      status: "available",
      statusLabel: i18n.t("newExperiment.environment.status.available"),
      message: configuredMessage,
    };
  }

  if (capability?.available) {
    return {
      backend,
      adapterId,
      status: "not_configured",
      statusLabel: i18n.t("common.notConfigured"),
      message: i18n.t("newExperiment.environment.messages.availableNoSubmitter", { label: capability.label }),
    };
  }

  return {
    backend,
    adapterId,
    status: "not_configured",
    statusLabel: i18n.t("common.notConfigured"),
    message: defaultMessage,
  };
}

function buildNativeBackendAvailability(
  options: BuildNewExperimentExecutionEnvironmentOptions,
): NewExperimentNativeBackendAvailability[] {
  const capabilities = options.executionBackendCapabilities ?? [];
  return [
    buildNativeBackendAvailabilityEntry({
      backend: "cluster",
      adapterId: CLUSTER_EXPERIMENT_EXECUTION_ADAPTER.id,
      capability: getCapabilityByBackend(capabilities, "cluster"),
      hasSubmitter: Boolean(options.submitClusterRun),
      configuredMessage: i18n.t("newExperiment.environment.messages.submitterConfigured", { backend: getNativeBackendLabel("cluster") }),
      defaultMessage: i18n.t("newExperiment.environment.messages.notConfiguredSubmitter", { backend: getNativeBackendLabel("cluster") }),
    }),
    buildNativeBackendAvailabilityEntry({
      backend: "wasm-local",
      adapterId: WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.id,
      capability: getCapabilityByBackend(capabilities, "wasm-local"),
      hasSubmitter: Boolean(options.submitWasmLocalRun),
      configuredMessage: i18n.t("newExperiment.environment.messages.submitterConfigured", { backend: getNativeBackendLabel("wasm-local") }),
      defaultMessage: i18n.t("newExperiment.environment.messages.notConfiguredSubmitter", { backend: getNativeBackendLabel("wasm-local") }),
    }),
  ];
}

function getNativeBackendAvailabilityByBackend(
  availability: readonly NewExperimentNativeBackendAvailability[],
  backend: NewExperimentNativeExecutionBackend,
): NewExperimentNativeBackendAvailability | undefined {
  return availability.find((candidate) => candidate.backend === backend);
}

function buildWorkspacePredictionPublicationAvailabilityEntry({
  backend,
  backendAvailability,
  capability,
  publisherBackends,
}: {
  backend: NewExperimentNativeExecutionBackend;
  backendAvailability?: NewExperimentNativeBackendAvailability;
  capability?: RunExecutionBackendCapability;
  publisherBackends: readonly NewExperimentNativeExecutionBackend[];
}): NewExperimentWorkspacePredictionPublicationAvailability {
  const destination = WORKSPACE_PREDICTION_PUBLICATION_DESTINATION;
  if (backendAvailability?.status === "backend_unavailable") {
    return {
      backend,
      status: "backend_unavailable",
      statusLabel: i18n.t("newExperiment.environment.status.unavailable"),
      destination,
      message: i18n.t("newExperiment.environment.statusWithMessage", {
        status: backendAvailability.statusLabel,
        message: backendAvailability.message,
      }),
    };
  }

  if (backendAvailability?.status !== "available") {
    return {
      backend,
      status: "not_configured",
      statusLabel: i18n.t("common.notConfigured"),
      destination,
      message: i18n.t("newExperiment.environment.messages.publicationUnavailable", {
        message: backendAvailability?.message
          ?? i18n.t("newExperiment.environment.messages.executionNotConfigured", { backend: getNativeBackendLabel(backend) }),
      }),
    };
  }

  if (publisherBackends.includes(backend) || capabilityDeclaresWorkspacePredictionPublisher(capability)) {
    return {
      backend,
      status: "publisher_configured",
      statusLabel: i18n.t("newExperiment.environment.status.publisherConfigured"),
      destination,
      message: i18n.t("newExperiment.environment.messages.publicationConfigured", {
        message: backendAvailability.message,
        destination,
      }),
    };
  }

  return {
    backend,
    status: "handoff_only",
    statusLabel: i18n.t("newExperiment.environment.status.handoffOnly"),
    destination,
    message: i18n.t("newExperiment.environment.messages.publicationHandoffOnly", { message: backendAvailability.message }),
  };
}

function buildWorkspacePredictionPublicationAvailability(
  nativeBackendAvailability: readonly NewExperimentNativeBackendAvailability[],
  options: BuildNewExperimentExecutionEnvironmentOptions,
): NewExperimentWorkspacePredictionPublicationAvailability[] {
  const publisherBackends = options.workspacePredictionPublicationBackends ?? [];
  const capabilities = options.executionBackendCapabilities ?? [];
  return [
    buildWorkspacePredictionPublicationAvailabilityEntry({
      backend: "cluster",
      backendAvailability: getNativeBackendAvailabilityByBackend(nativeBackendAvailability, "cluster"),
      capability: getCapabilityByBackend(capabilities, "cluster"),
      publisherBackends,
    }),
    buildWorkspacePredictionPublicationAvailabilityEntry({
      backend: "wasm-local",
      backendAvailability: getNativeBackendAvailabilityByBackend(nativeBackendAvailability, "wasm-local"),
      capability: getCapabilityByBackend(capabilities, "wasm-local"),
      publisherBackends,
    }),
  ];
}

export function buildNewExperimentExecutionEnvironment(
  options: BuildNewExperimentExecutionEnvironmentOptions = {},
): NewExperimentExecutionEnvironment {
  const executionBackendCapabilities = options.executionBackendCapabilities ?? [];

  if (
    !options.submitNativeLocalRun
    && !options.submitClusterRun
    && !options.submitWasmLocalRun
    && executionBackendCapabilities.length === 0
    && !options.workspacePredictionPublicationBackends?.length
  ) {
    return DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT;
  }

  const availableExecutionAdapters: ExperimentExecutionAdapter[] = [
    ...(options.submitNativeLocalRun ? [NATIVE_LOCAL_EXPERIMENT_EXECUTION_ADAPTER] : []),
    ...DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS,
  ];
  const launchSubmitters: SubmitExperimentLaunchSubmissionOptions = {};
  if (options.submitNativeLocalRun) {
    launchSubmitters.submitNativeLocalRun = options.submitNativeLocalRun;
  }
  const clusterCapability = getCapabilityByBackend(executionBackendCapabilities, "cluster");
  const wasmLocalCapability = getCapabilityByBackend(executionBackendCapabilities, "wasm-local");

  if (options.submitClusterRun && clusterCapability?.available !== false) {
    appendAdapterIfMissing(availableExecutionAdapters, CLUSTER_EXPERIMENT_EXECUTION_ADAPTER);
    launchSubmitters.submitClusterRun = options.submitClusterRun;
  }

  if (options.submitWasmLocalRun && wasmLocalCapability?.available !== false) {
    appendAdapterIfMissing(availableExecutionAdapters, WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER);
    launchSubmitters.submitWasmLocalRun = options.submitWasmLocalRun;
  }

  const nativeBackendAvailability = buildNativeBackendAvailability(options);
  const workspacePredictionPublicationAvailability = buildWorkspacePredictionPublicationAvailability(
    nativeBackendAvailability,
    options,
  );
  const environment = {
    availableExecutionAdapters,
    executionBackendCapabilities,
    launchSubmitters,
    nativeBackendAvailability,
    workspacePredictionPublicationAvailability,
  };

  return {
    ...environment,
    diagnostics: buildNewExperimentExecutionEnvironmentDiagnostics(environment),
  };
}
