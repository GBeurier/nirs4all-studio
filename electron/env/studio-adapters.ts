/**
 * Location of Studio's document adapters (`studio_document_adapters`), which
 * the sidecar adds to the scientific host's import path. They ship with the
 * application and are never copied into the user's environment.
 */

import path from "node:path";

import { loadRuntimeAdapterInstaller } from "./external-config";

let developmentAdaptersDir: string | null = null;

/**
 * Directory that contains the `studio_document_adapters/` package: the packaged
 * resource, or in development a Studio-owned cache directory materialised once
 * per process from the source tree.
 */
export function resolveStudioAdaptersDir(options: { packaged: boolean; resourcesPath: string; cacheDir: string }): string {
  if (options.packaged) return path.join(options.resourcesPath, "backend", "adapters");
  if (!developmentAdaptersDir) {
    const { installer, root } = loadRuntimeAdapterInstaller<{
      installRuntimeAdapters(root: string, target: string): unknown;
    }>();
    installer.installRuntimeAdapters(root, options.cacheDir);
    developmentAdaptersDir = options.cacheDir;
  }
  return developmentAdaptersDir;
}
