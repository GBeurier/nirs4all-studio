/**
 * CustomNodeStorageLocal - Browser localStorage persistence helpers for custom nodes.
 *
 * Owns the raw read/write/JSON side effects through `clientStorage` so that
 * CustomNodeStorage can stay focused on orchestration. These helpers do not
 * make validation or workspace-merge decisions (those belong to
 * CustomNodeStoragePolicy / CustomNodeStorageWorkspace); they only serialize
 * and persist already-decided values, swallowing storage failures with a log.
 */

import type { CustomNodesFile, NodeDefinition } from '../types';
import { clientStorageKeys, readClientStorageString, writeClientStorageString } from '@/lib/clientStorage';
import { createLogger } from '@/lib/logger';
import { createCustomNodesFile } from './CustomNodeStoragePolicy';

const logger = createLogger('CustomNodeStorageLocal');

export interface StoredCustomNodeSecurityConfig {
  allowCustomNodes: boolean;
  allowedPackages: string[];
  requireApproval: boolean;
  allowUserPackages: boolean;
}

/**
 * localStorage keys used for custom node persistence.
 */
export const STORAGE_KEYS = {
  CUSTOM_NODES: clientStorageKeys.customNodes.key,
  SECURITY_CONFIG: clientStorageKeys.customNodesSecurityConfig.key,
  USER_PACKAGES: clientStorageKeys.customNodesUserPackages.key,
  VERSION: clientStorageKeys.customNodesVersion.key,
} as const;

/**
 * Read the stored custom nodes file, or null when nothing is stored or parsing fails.
 */
export function readStoredCustomNodes(): CustomNodesFile | null {
  try {
    const stored = readClientStorageString(clientStorageKeys.customNodes, {
      onError: (error) => {
        throw error;
      },
    });
    if (stored) {
      return JSON.parse(stored) as CustomNodesFile;
    }
  } catch (err) {
    logger.error('Failed to load custom nodes from storage:', err);
  }
  return null;
}

/**
 * Read the persisted custom nodes schema version, or null when absent.
 */
export function readStoredVersion(): string | null {
  return readClientStorageString(clientStorageKeys.customNodesVersion, {
    onError: (error) => {
      throw error;
    },
  });
}

/**
 * Persist the given nodes as a versioned custom nodes file.
 */
export function writeStoredCustomNodes(nodes: NodeDefinition[], version: string): void {
  try {
    const data = createCustomNodesFile(nodes, version);
    writeClientStorageString(clientStorageKeys.customNodes, JSON.stringify(data), {
      onError: (error) => {
        throw error;
      },
    });
    writeClientStorageString(clientStorageKeys.customNodesVersion, version, {
      onError: (error) => {
        throw error;
      },
    });
  } catch (err) {
    logger.error('Failed to save custom nodes to storage:', err);
  }
}

/**
 * Read the stored security config, falling back to the provided default.
 */
export function readSecurityConfig(
  fallback: StoredCustomNodeSecurityConfig
): StoredCustomNodeSecurityConfig {
  try {
    const stored = readClientStorageString(clientStorageKeys.customNodesSecurityConfig);
    if (stored) {
      return JSON.parse(stored) as StoredCustomNodeSecurityConfig;
    }
  } catch {
    // Use defaults
  }
  return fallback;
}

/**
 * Persist the security config.
 */
export function writeSecurityConfig(config: StoredCustomNodeSecurityConfig): void {
  try {
    writeClientStorageString(clientStorageKeys.customNodesSecurityConfig, JSON.stringify(config), {
      onError: (error) => {
        throw error;
      },
    });
  } catch (err) {
    logger.error('Failed to save security config:', err);
  }
}

/**
 * Read the user-defined package allowlist, or an empty array on miss/parse failure.
 */
export function readUserPackages(): string[] {
  try {
    const stored = readClientStorageString(clientStorageKeys.customNodesUserPackages);
    if (stored) {
      return JSON.parse(stored) as string[];
    }
  } catch {
    // Use empty array
  }
  return [];
}

/**
 * Persist the user-defined package allowlist.
 */
export function writeUserPackages(packages: string[]): void {
  try {
    writeClientStorageString(clientStorageKeys.customNodesUserPackages, JSON.stringify(packages), {
      onError: (error) => {
        throw error;
      },
    });
  } catch (err) {
    logger.error('Failed to save user packages:', err);
  }
}
