import {
  CLUSTER_EXPERIMENT_EXECUTION_ADAPTER,
  DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS,
  WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
  type ExperimentExecutionAdapter,
  type ExperimentExecutionAdapterId,
  type SubmitClusterRun,
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

export interface NewExperimentNativeBackendAvailability {
  backend: NewExperimentNativeExecutionBackend;
  adapterId: ExperimentExecutionAdapterId;
  status: NewExperimentNativeBackendAvailabilityStatus;
  statusLabel: string;
  message: string;
}

export interface NewExperimentExecutionEnvironmentDiagnostics {
  availableAdapterIds: ExperimentExecutionAdapterId[];
  availableExecutionBackends?: RunExecutionBackend[];
  configuredNativeBackends: NewExperimentNativeExecutionBackend[];
  unconfiguredNativeBackends: NewExperimentNativeExecutionBackend[];
  unavailableExecutionBackends?: RunExecutionBackend[];
  unavailableNativeBackends?: NewExperimentNativeExecutionBackend[];
  hasClusterSubmitter: boolean;
  hasWasmLocalSubmitter: boolean;
}

export interface NewExperimentExecutionEnvironment {
  availableExecutionAdapters: readonly ExperimentExecutionAdapter[];
  executionBackendCapabilities: readonly RunExecutionBackendCapability[];
  launchSubmitters: SubmitExperimentLaunchSubmissionOptions;
  nativeBackendAvailability: readonly NewExperimentNativeBackendAvailability[];
  diagnostics: NewExperimentExecutionEnvironmentDiagnostics;
}

export interface BuildNewExperimentExecutionEnvironmentOptions {
  executionBackendCapabilities?: readonly RunExecutionBackendCapability[];
  submitClusterRun?: SubmitClusterRun;
  submitWasmLocalRun?: SubmitWasmLocalRun;
}

function isExecutionEnvironmentOptionsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKnownExecutionBackend(value: unknown): value is RunExecutionBackend {
  return value === "local-python" || value === "cluster" || value === "wasm-local";
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

export function normalizeNewExperimentExecutionEnvironmentOptions(
  options: unknown,
): BuildNewExperimentExecutionEnvironmentOptions | undefined {
  if (!isExecutionEnvironmentOptionsRecord(options)) return undefined;

  const normalized: BuildNewExperimentExecutionEnvironmentOptions = {};
  const executionBackendCapabilities = normalizeExecutionBackendCapabilities(options.executionBackendCapabilities);
  const submitClusterRun = options.submitClusterRun;
  const submitWasmLocalRun = options.submitWasmLocalRun;

  if (executionBackendCapabilities) {
    normalized.executionBackendCapabilities = executionBackendCapabilities;
  }

  if (typeof submitClusterRun === "function") {
    normalized.submitClusterRun = submitClusterRun as SubmitClusterRun;
  }

  if (typeof submitWasmLocalRun === "function") {
    normalized.submitWasmLocalRun = submitWasmLocalRun as SubmitWasmLocalRun;
  }

  return normalized.executionBackendCapabilities || normalized.submitClusterRun || normalized.submitWasmLocalRun
    ? normalized
    : undefined;
}

export const DEFAULT_NEW_EXPERIMENT_LAUNCH_SUBMITTERS: SubmitExperimentLaunchSubmissionOptions = {};

const DEFAULT_NATIVE_BACKEND_AVAILABILITY: readonly NewExperimentNativeBackendAvailability[] = [
  {
    backend: "cluster",
    adapterId: CLUSTER_EXPERIMENT_EXECUTION_ADAPTER.id,
    status: "not_configured",
    statusLabel: "Not configured",
    message: "Cluster execution is typed but no native submitter is configured.",
  },
  {
    backend: "wasm-local",
    adapterId: WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.id,
    status: "not_configured",
    statusLabel: "Not configured",
    message: "WASM local execution is typed but no native submitter is configured.",
  },
];

export function buildNewExperimentExecutionEnvironmentDiagnostics(
  environment: Pick<
    NewExperimentExecutionEnvironment,
    "availableExecutionAdapters" | "executionBackendCapabilities" | "launchSubmitters" | "nativeBackendAvailability"
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
    hasClusterSubmitter: Boolean(environment.launchSubmitters.submitClusterRun),
    hasWasmLocalSubmitter: Boolean(environment.launchSubmitters.submitWasmLocalRun),
  };
}

export const DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT: NewExperimentExecutionEnvironment = {
  availableExecutionAdapters: DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS,
  executionBackendCapabilities: [],
  launchSubmitters: DEFAULT_NEW_EXPERIMENT_LAUNCH_SUBMITTERS,
  nativeBackendAvailability: DEFAULT_NATIVE_BACKEND_AVAILABILITY,
  diagnostics: buildNewExperimentExecutionEnvironmentDiagnostics({
    availableExecutionAdapters: DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS,
    executionBackendCapabilities: [],
    launchSubmitters: DEFAULT_NEW_EXPERIMENT_LAUNCH_SUBMITTERS,
    nativeBackendAvailability: DEFAULT_NATIVE_BACKEND_AVAILABILITY,
  }),
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
      statusLabel: "Unavailable",
      message: getCapabilityMessage(
        capability,
        `${capability.label} execution is typed but no execution driver is configured.`,
      ),
    };
  }

  if (hasSubmitter) {
    return {
      backend,
      adapterId,
      status: "available",
      statusLabel: "Available",
      message: configuredMessage,
    };
  }

  if (capability?.available) {
    return {
      backend,
      adapterId,
      status: "not_configured",
      statusLabel: "Not configured",
      message: `${capability.label} execution backend is available, but no native submitter is configured.`,
    };
  }

  return {
    backend,
    adapterId,
    status: "not_configured",
    statusLabel: "Not configured",
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
      configuredMessage: "Cluster execution submitter is configured.",
      defaultMessage: "Cluster execution is typed but no native submitter is configured.",
    }),
    buildNativeBackendAvailabilityEntry({
      backend: "wasm-local",
      adapterId: WASM_LOCAL_EXPERIMENT_EXECUTION_ADAPTER.id,
      capability: getCapabilityByBackend(capabilities, "wasm-local"),
      hasSubmitter: Boolean(options.submitWasmLocalRun),
      configuredMessage: "WASM local execution submitter is configured.",
      defaultMessage: "WASM local execution is typed but no native submitter is configured.",
    }),
  ];
}

export function buildNewExperimentExecutionEnvironment(
  options: BuildNewExperimentExecutionEnvironmentOptions = {},
): NewExperimentExecutionEnvironment {
  const executionBackendCapabilities = options.executionBackendCapabilities ?? [];

  if (!options.submitClusterRun && !options.submitWasmLocalRun && executionBackendCapabilities.length === 0) {
    return DEFAULT_NEW_EXPERIMENT_EXECUTION_ENVIRONMENT;
  }

  const availableExecutionAdapters: ExperimentExecutionAdapter[] = [
    ...DEFAULT_EXPERIMENT_EXECUTION_ADAPTERS,
  ];
  const launchSubmitters: SubmitExperimentLaunchSubmissionOptions = {};
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

  const environment = {
    availableExecutionAdapters,
    executionBackendCapabilities,
    launchSubmitters,
    nativeBackendAvailability: buildNativeBackendAvailability(options),
  };

  return {
    ...environment,
    diagnostics: buildNewExperimentExecutionEnvironmentDiagnostics(environment),
  };
}
