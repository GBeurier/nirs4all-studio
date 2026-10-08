/** Install only Studio's attested document adapters in a reused interpreter. */
import { execFileText } from "./process-utils";
import { loadRuntimeAdapterInstaller } from "./external-config";
import { detectBundledRuntime } from "./runtime-paths";
import path from "node:path";

export async function prepareRuntimeAdapters(pythonPath: string): Promise<string> {
  const probe = await execFileText(pythonPath, ["-B", "-c", `import importlib.metadata, os, site, sysconfig
target = sysconfig.get_path('purelib')
user = site.getusersitepackages()
try:
    installed = str(importlib.metadata.distribution('nirs4all').locate_file(''))
    if os.path.normcase(os.path.abspath(installed)) == os.path.normcase(os.path.abspath(user)):
        target = user
except importlib.metadata.PackageNotFoundError:
    pass
if not os.access(target, os.W_OK):
    target = user
print(target)`], 15_000);
  const sitePackages = probe?.stdout.trim();
  if (!sitePackages || !path.isAbsolute(sitePackages)) throw new Error("Cannot locate the selected Python environment's package folder.");
  const { installer, root } = loadRuntimeAdapterInstaller<{
    installRuntimeAdapters(root: string, target: string, source?: string): void;
  }>();
  installer.installRuntimeAdapters(root, sitePackages, detectBundledRuntime()?.sitePackages);
  return sitePackages;
}
