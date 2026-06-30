import type { ClientStorageKey } from "./keyRegistry";

export interface VersionedClientStorageRecord<TValue> {
  value: TValue;
  version: number;
}

export type ClientStorageMigration<TValue> = (value: unknown) => TValue;

export type ClientStorageMigrationMap<TValue> = Partial<Record<number, ClientStorageMigration<TValue>>>;

export function isVersionedClientStorageRecord<TValue = unknown>(
  value: unknown,
): value is VersionedClientStorageRecord<TValue> {
  return (
    typeof value === "object"
    && value !== null
    && "version" in value
    && "value" in value
    && typeof (value as { version?: unknown }).version === "number"
  );
}

export function createVersionedClientStorageRecord<TValue>(
  storageKey: ClientStorageKey<TValue>,
  value: TValue,
): VersionedClientStorageRecord<TValue> {
  return {
    value,
    version: storageKey.version,
  };
}

export function migrateClientStorageValue<TValue>(
  storageKey: ClientStorageKey<TValue>,
  parsed: unknown,
  migrations: ClientStorageMigrationMap<TValue> = {},
): TValue {
  if (!isVersionedClientStorageRecord<TValue>(parsed)) {
    return parsed as TValue;
  }

  if (parsed.version === storageKey.version) {
    return parsed.value;
  }

  const migration = migrations[parsed.version];
  if (migration) {
    return migration(parsed.value);
  }

  return parsed.value;
}
