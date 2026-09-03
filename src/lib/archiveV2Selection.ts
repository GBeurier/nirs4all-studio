import { clientStorageKeys } from "@/lib/clientStorage/keyRegistry";
import type { ClientStorageKey } from "@/lib/clientStorage/keyRegistry";
import {
  readClientStorageString,
  removeClientStorageItem,
  writeVersionedClientStorageJson,
} from "@/lib/clientStorage/store";
import type {
  ArchiveV2ArrayPredictionRequest,
  ArchiveV2SelectionDraft,
  PersistedArchiveV2Selection,
} from "@/types/archiveV2Prediction";

const MAX_PERSISTED_SELECTION_BYTES = 4 * 1024;
const MAX_SAMPLES = 128;
const MAX_FEATURES = 256;
const MAX_CELLS = 16_384;
const MAX_TARGETS = 64;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_ARCHIVE_REF_LENGTH = 240;
const IDENTIFIER = /^[A-Za-z0-9._:-]+$/;
const SHA256 = /^[a-f0-9]{64}$/;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    IDENTIFIER.test(value)
  );
}

function isArchiveRef(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ARCHIVE_REF_LENGTH ||
    value.startsWith("/") ||
    value.includes("\\") ||
    !value.endsWith(".n4a")
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (component) =>
        component !== "." && component !== ".." && isIdentifier(component),
    );
}

function isTargetNames(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_TARGETS &&
    value.every(isIdentifier) &&
    new Set(value).size === value.length
  );
}

export function isPersistedArchiveV2Selection(
  value: unknown,
): value is PersistedArchiveV2Selection {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "kind",
      "workspace_id",
      "archive_ref",
      "archive_sha256",
      "n_features",
      "target_names",
    ]) ||
    value.schema_version !== 1 ||
    value.kind !== "persisted_archive_v2" ||
    !isIdentifier(value.workspace_id) ||
    !isArchiveRef(value.archive_ref) ||
    typeof value.archive_sha256 !== "string" ||
    !SHA256.test(value.archive_sha256) ||
    !Number.isInteger(value.n_features) ||
    (value.n_features as number) < 1 ||
    (value.n_features as number) > MAX_FEATURES ||
    !isTargetNames(value.target_names)
  ) {
    return false;
  }
  return JSON.stringify(value).length <= MAX_PERSISTED_SELECTION_BYTES;
}

export function createPersistedArchiveV2Selection(
  draft: ArchiveV2SelectionDraft,
): PersistedArchiveV2Selection {
  const selection: PersistedArchiveV2Selection = {
    schema_version: 1,
    kind: "persisted_archive_v2",
    workspace_id: draft.workspace_id.trim(),
    archive_ref: draft.archive_ref.trim(),
    archive_sha256: draft.archive_sha256.trim(),
    n_features: draft.n_features,
    target_names: draft.target_names.map((name) => name.trim()),
  };
  if (!isPersistedArchiveV2Selection(selection)) {
    throw new TypeError(
      "Invalid Archive V2 selection: use a relative .n4a ref, lowercase SHA256, positive feature count, and unique ordered target identifiers.",
    );
  }
  return selection;
}

export function parseArchiveV2TargetNames(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function archiveV2SelectionIdentityEquals(
  left: PersistedArchiveV2Selection,
  right: PersistedArchiveV2Selection,
): boolean {
  return (
    left.workspace_id === right.workspace_id &&
    left.archive_ref === right.archive_ref &&
    left.archive_sha256 === right.archive_sha256 &&
    left.n_features === right.n_features &&
    left.target_names.length === right.target_names.length &&
    left.target_names.every((name, index) => name === right.target_names[index])
  );
}

export function readPersistedArchiveV2Selection(): PersistedArchiveV2Selection | null {
  const storageKey =
    clientStorageKeys.predictArchiveV2Selection as ClientStorageKey<string>;
  const raw = readClientStorageString(storageKey);
  if (raw === null) return null;

  try {
    if (raw.length > MAX_PERSISTED_SELECTION_BYTES + 128) {
      throw new TypeError("oversized selection");
    }
    const record = JSON.parse(raw) as unknown;
    if (
      !isRecord(record) ||
      !hasExactKeys(record, ["version", "value"]) ||
      record.version !== clientStorageKeys.predictArchiveV2Selection.version ||
      !isPersistedArchiveV2Selection(record.value)
    ) {
      throw new TypeError("legacy or invalid selection");
    }
    return record.value;
  } catch {
    removeClientStorageItem(clientStorageKeys.predictArchiveV2Selection);
    return null;
  }
}

export function persistArchiveV2Selection(
  selection: PersistedArchiveV2Selection,
): void {
  if (!isPersistedArchiveV2Selection(selection)) {
    throw new TypeError("Invalid Archive V2 selection");
  }
  writeVersionedClientStorageJson(
    clientStorageKeys.predictArchiveV2Selection,
    selection,
  );
  const persisted = readPersistedArchiveV2Selection();
  if (!persisted || !archiveV2SelectionIdentityEquals(selection, persisted)) {
    throw new Error("The Archive V2 selection could not be persisted safely.");
  }
}

export function clearPersistedArchiveV2Selection(): void {
  removeClientStorageItem(clientStorageKeys.predictArchiveV2Selection);
}

export function buildArchiveV2ArrayPredictionRequest(
  selection: PersistedArchiveV2Selection,
  spectra: readonly (readonly number[])[],
): ArchiveV2ArrayPredictionRequest {
  if (!isPersistedArchiveV2Selection(selection)) {
    throw new TypeError("The Archive V2 identity or ordered targets are invalid.");
  }
  if (
    spectra.length === 0 ||
    spectra.length > MAX_SAMPLES ||
    spectra.length * selection.n_features > MAX_CELLS ||
    spectra.some(
      (row) =>
        row.length !== selection.n_features ||
        row.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new TypeError(
      `Input width must be exactly ${selection.n_features} finite features for every sample.`,
    );
  }

  return {
    schema_version: 1,
    operation: "archive_v2_predict",
    workspace_id: selection.workspace_id,
    archive: {
      ref: selection.archive_ref,
      sha256: selection.archive_sha256,
    },
    input: {
      kind: "array",
      sample_ids: spectra.map((_, index) => `predict.${index}`),
      x: spectra,
      expected_target_names: selection.target_names,
    },
    execution: {
      engine: "core_rust_methods",
      allow_fallback: false,
    },
  };
}
