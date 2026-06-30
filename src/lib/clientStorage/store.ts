import type { ClientStorageArea, ClientStorageKey } from "./keyRegistry";
import {
  createVersionedClientStorageRecord,
  migrateClientStorageValue,
  type ClientStorageMigrationMap,
  type VersionedClientStorageRecord,
} from "./migrations";

export interface ClientStorageUnavailableReason {
  area: ClientStorageArea;
  error?: unknown;
  reason: "missing_window" | "missing_storage" | "storage_error";
}

export interface ClientStorageReadOptions<TValue> {
  fallback?: TValue;
  migrate?: (value: unknown) => TValue;
  onError?: (error: unknown) => void;
}

export interface ClientStorageWriteOptions {
  onError?: (error: unknown) => void;
}

export interface ClientStoragePersistenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface VersionedClientStorageReadOptions<TValue>
  extends ClientStorageReadOptions<TValue | null> {
  migrations?: ClientStorageMigrationMap<TValue>;
}

type StorageLike = Pick<Storage, "clear" | "getItem" | "key" | "length" | "removeItem" | "setItem">;

function resolveStorage(area: ClientStorageArea): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function handleError(error: unknown, onError?: (error: unknown) => void): void {
  onError?.(error);
}

export function isClientStorageAvailable(area: ClientStorageArea): boolean {
  return resolveStorage(area) !== null;
}

export function readClientStorageString(
  storageKey: ClientStorageKey<string>,
  options: ClientStorageReadOptions<string | null> = {},
): string | null {
  const storage = resolveStorage(storageKey.area);
  if (!storage) {
    return options.fallback ?? null;
  }

  try {
    const value = storage.getItem(storageKey.key);
    return value ?? options.fallback ?? null;
  } catch (error) {
    handleError(error, options.onError);
    return options.fallback ?? null;
  }
}

export function readClientStorageJson<TValue>(
  storageKey: ClientStorageKey<TValue>,
  options: ClientStorageReadOptions<TValue | null> = {},
): TValue | null {
  const raw = readClientStorageString(
    storageKey as ClientStorageKey<string>,
    options.fallback === undefined
      ? { onError: options.onError }
      : { fallback: null, onError: options.onError },
  );
  if (raw === null) {
    return options.fallback ?? null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return options.migrate ? options.migrate(parsed) : (parsed as TValue);
  } catch (error) {
    handleError(error, options.onError);
    return options.fallback ?? null;
  }
}

export function writeClientStorageString(
  storageKey: ClientStorageKey<string>,
  value: string,
  options: ClientStorageWriteOptions = {},
): void {
  const storage = resolveStorage(storageKey.area);
  if (!storage) {
    return;
  }

  try {
    storage.setItem(storageKey.key, value);
  } catch (error) {
    handleError(error, options.onError);
  }
}

export function writeClientStorageJson<TValue>(
  storageKey: ClientStorageKey<TValue>,
  value: TValue,
  options: ClientStorageWriteOptions = {},
): void {
  const storage = resolveStorage(storageKey.area);
  if (!storage) {
    return;
  }

  try {
    storage.setItem(storageKey.key, JSON.stringify(value));
  } catch (error) {
    handleError(error, options.onError);
  }
}

export function readVersionedClientStorageJson<TValue>(
  storageKey: ClientStorageKey<TValue>,
  options: VersionedClientStorageReadOptions<TValue> = {},
): TValue | null {
  return readClientStorageJson(storageKey, {
    fallback: options.fallback,
    migrate: (parsed) => migrateClientStorageValue(storageKey, parsed, options.migrations),
    onError: options.onError,
  });
}

export function writeVersionedClientStorageJson<TValue>(
  storageKey: ClientStorageKey<TValue>,
  value: TValue,
  options: ClientStorageWriteOptions = {},
): void {
  const versionedKey = storageKey as unknown as ClientStorageKey<VersionedClientStorageRecord<TValue>>;
  writeClientStorageJson(
    versionedKey,
    createVersionedClientStorageRecord(storageKey, value),
    options,
  );
}

export function removeClientStorageItem(
  storageKey: ClientStorageKey<unknown>,
  options: ClientStorageWriteOptions = {},
): void {
  const storage = resolveStorage(storageKey.area);
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(storageKey.key);
  } catch (error) {
    handleError(error, options.onError);
  }
}

export function createClientStoragePersistenceStorage(
  storageKey: ClientStorageKey<string>,
): ClientStoragePersistenceStorage {
  return {
    getItem: key => {
      if (key !== storageKey.key) return null;
      return readClientStorageString(storageKey);
    },
    setItem: (key, value) => {
      if (key !== storageKey.key) return;
      writeClientStorageString(storageKey, value);
    },
    removeItem: key => {
      if (key !== storageKey.key) return;
      removeClientStorageItem(storageKey);
    },
  };
}

export function clearClientStorageArea(
  area: ClientStorageArea,
  options: ClientStorageWriteOptions = {},
): void {
  const storage = resolveStorage(area);
  if (!storage) {
    return;
  }

  try {
    storage.clear();
  } catch (error) {
    handleError(error, options.onError);
  }
}

export function listClientStorageItemKeys(
  area: ClientStorageArea,
  options: ClientStorageWriteOptions = {},
): string[] {
  const storage = resolveStorage(area);
  if (!storage) {
    return [];
  }

  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) {
        keys.push(key);
      }
    }
    return keys;
  } catch (error) {
    handleError(error, options.onError);
    return [];
  }
}
