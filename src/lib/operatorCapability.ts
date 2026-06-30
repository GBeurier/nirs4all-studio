export const CAPABILITY_LEVELS = [
  "unavailable",
  "metadata",
  "plan",
  "execute_local",
  "execute_remote",
  "execute_wasm",
] as const;

export type CapabilityLevel = typeof CAPABILITY_LEVELS[number];

export type OperatorBackendId =
  | "nirs4all"
  | "n4a-methods"
  | "sklearn"
  | "custom"
  | "local"
  | "cluster"
  | "wasm"
  | string;

export interface OperatorImplementationRef {
  backend: OperatorBackendId;
  id?: string;
  label?: string;
  level?: CapabilityLevel;
  compute?: string[];
}

export interface OperatorCapabilityDeclaration {
  defaultLevel?: CapabilityLevel;
  implementationRefs?: OperatorImplementationRef[];
  requiredPackages?: string[];
}

export interface OperatorCapabilityNode {
  id?: string;
  type?: string;
  name?: string;
  classPath?: string | null;
  functionPath?: string | null;
  source?: string;
  isDeepLearning?: boolean;
  capabilities?: OperatorCapabilityDeclaration;
  implementationRefs?: OperatorImplementationRef[];
}

export interface OperatorCapabilityEntry {
  id?: string;
  name?: string;
  type?: string;
  class_path?: string | null;
  function_path?: string | null;
  level?: CapabilityLevel;
  capability_level?: CapabilityLevel;
  backend?: OperatorBackendId;
  implementation_ref?: string;
  compute?: string[];
  available?: boolean;
  error?: string | null;
  reason?: string | null;
}

export interface LegacyUnavailableOperatorEntry {
  id?: string;
  name?: string;
  type?: string;
  class_path?: string | null;
  function_path?: string | null;
  error?: string | null;
}

export interface OperatorCapabilityReport {
  capabilities?: OperatorCapabilityEntry[];
  unavailable?: LegacyUnavailableOperatorEntry[];
}

export interface OperatorCapabilityResolution {
  available: boolean;
  backend?: OperatorBackendId;
  compute?: string[];
  entry?: OperatorCapabilityEntry | LegacyUnavailableOperatorEntry;
  executable: boolean;
  implementationRef?: string;
  level: CapabilityLevel;
  reason?: string | null;
  source: "backend_report" | "legacy_unavailable" | "node_declaration" | "default";
}

const CAPABILITY_LEVEL_RANK: Record<CapabilityLevel, number> = {
  unavailable: 0,
  metadata: 1,
  plan: 2,
  execute_local: 3,
  execute_remote: 4,
  execute_wasm: 4,
};

function isCapabilityLevel(value: unknown): value is CapabilityLevel {
  return typeof value === "string" && (CAPABILITY_LEVELS as readonly string[]).includes(value);
}

export function compareCapabilityLevels(left: CapabilityLevel, right: CapabilityLevel): number {
  return CAPABILITY_LEVEL_RANK[left] - CAPABILITY_LEVEL_RANK[right];
}

export function isExecutableCapabilityLevel(level: CapabilityLevel): boolean {
  return compareCapabilityLevels(level, "execute_local") >= 0;
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeTypeAndName(type?: string, name?: string): string | null {
  const normalizedType = normalizeText(type);
  const normalizedName = normalizeText(name);
  return normalizedType && normalizedName ? `${normalizedType}:${normalizedName}` : null;
}

function matchesEntry(
  node: OperatorCapabilityNode,
  entry: OperatorCapabilityEntry | LegacyUnavailableOperatorEntry,
): boolean {
  if (node.id && entry.id && normalizeText(node.id) === normalizeText(entry.id)) {
    return true;
  }
  if (node.functionPath && entry.function_path && normalizeText(node.functionPath) === normalizeText(entry.function_path)) {
    return true;
  }
  if (node.classPath && entry.class_path && normalizeText(node.classPath) === normalizeText(entry.class_path)) {
    return true;
  }

  const nodeTypeAndName = normalizeTypeAndName(node.type, node.name);
  const entryTypeAndName = normalizeTypeAndName(entry.type, entry.name);
  return Boolean(nodeTypeAndName && entryTypeAndName && nodeTypeAndName === entryTypeAndName);
}

function resolveEntryLevel(entry: OperatorCapabilityEntry): CapabilityLevel {
  if (isCapabilityLevel(entry.level)) {
    return entry.level;
  }
  if (isCapabilityLevel(entry.capability_level)) {
    return entry.capability_level;
  }
  if (entry.available === false) {
    return "metadata";
  }
  return "execute_local";
}

function resolveDeclarationLevel(node: OperatorCapabilityNode): OperatorCapabilityResolution | null {
  const refs = node.capabilities?.implementationRefs ?? node.implementationRefs ?? [];
  const explicitLevel = node.capabilities?.defaultLevel;
  if (isCapabilityLevel(explicitLevel)) {
    return {
      available: isExecutableCapabilityLevel(explicitLevel),
      executable: isExecutableCapabilityLevel(explicitLevel),
      level: explicitLevel,
      source: "node_declaration",
    };
  }

  if (refs.length === 0) {
    return null;
  }

  const bestRef = refs.reduce<OperatorImplementationRef | null>((best, ref) => {
    const level = isCapabilityLevel(ref.level) ? ref.level : "execute_local";
    if (!best) {
      return ref;
    }
    const bestLevel = isCapabilityLevel(best.level) ? best.level : "execute_local";
    return compareCapabilityLevels(level, bestLevel) > 0 ? ref : best;
  }, null);
  if (!bestRef) {
    return null;
  }

  const level = isCapabilityLevel(bestRef.level) ? bestRef.level : "execute_local";
  return {
    available: isExecutableCapabilityLevel(level),
    backend: bestRef.backend,
    compute: bestRef.compute,
    executable: isExecutableCapabilityLevel(level),
    implementationRef: bestRef.id,
    level,
    source: "node_declaration",
  };
}

export function resolveOperatorCapability(
  node: OperatorCapabilityNode,
  report?: OperatorCapabilityReport | null,
): OperatorCapabilityResolution {
  const capabilityEntry = report?.capabilities?.find((entry) => matchesEntry(node, entry));
  if (capabilityEntry) {
    const level = resolveEntryLevel(capabilityEntry);
    const executable = isExecutableCapabilityLevel(level) && capabilityEntry.available !== false;
    return {
      available: executable,
      backend: capabilityEntry.backend,
      compute: capabilityEntry.compute,
      entry: capabilityEntry,
      executable,
      implementationRef: capabilityEntry.implementation_ref,
      level,
      reason: capabilityEntry.reason ?? capabilityEntry.error,
      source: "backend_report",
    };
  }

  const legacyUnavailable = report?.unavailable?.find((entry) => matchesEntry(node, entry));
  if (legacyUnavailable) {
    return {
      available: false,
      entry: legacyUnavailable,
      executable: false,
      level: "metadata",
      reason: legacyUnavailable.error,
      source: "legacy_unavailable",
    };
  }

  const declaration = resolveDeclarationLevel(node);
  if (declaration) {
    return declaration;
  }

  return {
    available: true,
    executable: true,
    level: "execute_local",
    source: "default",
  };
}

export function buildLegacyUnavailableFromCapabilityReport(
  report: OperatorCapabilityReport,
): LegacyUnavailableOperatorEntry[] {
  const legacy = report.unavailable ?? [];
  const derived = (report.capabilities ?? [])
    .filter((entry) => {
      const level = resolveEntryLevel(entry);
      return !isExecutableCapabilityLevel(level) || entry.available === false;
    })
    .map((entry): LegacyUnavailableOperatorEntry => ({
      id: entry.id,
      name: entry.name ?? entry.id ?? "Operator",
      type: entry.type ?? "operator",
      class_path: entry.class_path,
      function_path: entry.function_path,
      error: entry.error ?? entry.reason ?? "Operator is not executable in the selected backend.",
    }));

  return [...legacy, ...derived];
}
