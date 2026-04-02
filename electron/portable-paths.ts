import fs from "node:fs";
import path from "node:path";

export interface PortableLayout {
  executablePath: string;
  portableRoot: string;
  userDataDir: string;
  configDir: string;
  backendDataDir: string;
  backendLogDir: string;
}

type PortableEnv = NodeJS.ProcessEnv;

const BACKEND_APP_NAME = "nirs4all-webapp";
const LEGACY_ELECTRON_USERDATA_DIRS = ["nirs4all-webapp", "nirs4all Studio"];
const LEGACY_CONFIG_DIRS = ["nirs4all"];
const LEGACY_BACKEND_DATA_DIRS = [
  path.join("nirs4all", BACKEND_APP_NAME),
  BACKEND_APP_NAME,
];
const LEGACY_USERDATA_ITEMS = [
  "env-settings.json",
  "python-env",
];
const LEGACY_CONFIG_ITEMS = [
  "app_settings.json",
  "dataset_links.json",
  "config_redirect.txt",
];
const LEGACY_BACKEND_DATA_ITEMS = [
  "recommended_config_cache.json",
  "setup_status.json",
  "dependencies_cache.json",
  "venv_settings.json",
  "config_snapshots",
];

function resolvePortableExecutable(env: PortableEnv): string | null {
  const portableExe = env.PORTABLE_EXECUTABLE_FILE?.trim();
  if (!portableExe) return null;
  return path.resolve(portableExe);
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const candidate of paths) {
    if (!candidate) continue;
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    resolved.push(normalized);
  }

  return resolved;
}

function copyPathIfMissing(sourcePath: string, targetPath: string): boolean {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const sourceStat = fs.statSync(sourcePath);

  if (sourceStat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true, force: false });
    return true;
  }

  if (sourceStat.isFile()) {
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    return true;
  }

  return false;
}

function migrateItemsIfMissing(
  sourceRoots: string[],
  targetRoot: string,
  items: string[],
): string[] {
  const migrated: string[] = [];

  for (const item of items) {
    const targetPath = path.join(targetRoot, item);
    if (fs.existsSync(targetPath)) continue;

    for (const sourceRoot of sourceRoots) {
      const sourcePath = path.join(sourceRoot, item);
      if (!copyPathIfMissing(sourcePath, targetPath)) continue;
      migrated.push(`${sourcePath} -> ${targetPath}`);
      break;
    }
  }

  return migrated;
}

function migrateLegacyPortableState(layout: PortableLayout, env: PortableEnv): void {
  const appData = env.APPDATA?.trim();
  const localAppData = env.LOCALAPPDATA?.trim();
  const backendPortableDataDir = path.join(layout.backendDataDir, BACKEND_APP_NAME);

  const roamingUserDataRoots = uniquePaths([
    layout.portableRoot,
    ...LEGACY_ELECTRON_USERDATA_DIRS.map((dir) => appData ? path.join(appData, dir) : null),
  ]);
  const configRoots = uniquePaths([
    layout.portableRoot,
    ...LEGACY_CONFIG_DIRS.map((dir) => appData ? path.join(appData, dir) : null),
  ]);
  const backendDataRoots = uniquePaths([
    layout.portableRoot,
    ...LEGACY_BACKEND_DATA_DIRS.map((dir) => localAppData ? path.join(localAppData, dir) : null),
  ]);

  const migrated = [
    ...migrateItemsIfMissing(roamingUserDataRoots, layout.userDataDir, LEGACY_USERDATA_ITEMS),
    ...migrateItemsIfMissing(configRoots, layout.configDir, LEGACY_CONFIG_ITEMS),
    ...migrateItemsIfMissing(backendDataRoots, backendPortableDataDir, LEGACY_BACKEND_DATA_ITEMS),
  ];

  if (migrated.length > 0) {
    console.log(`Migrated legacy portable state:\n${migrated.join("\n")}`);
  }
}

export function resolvePortableLayout(env: PortableEnv = process.env): PortableLayout | null {
  const executablePath = resolvePortableExecutable(env);
  if (!executablePath) return null;

  const portableRoot = path.join(path.dirname(executablePath), ".nirs4all");
  return {
    executablePath,
    portableRoot,
    userDataDir: path.join(portableRoot, "userData"),
    configDir: path.join(portableRoot, "config"),
    backendDataDir: path.join(portableRoot, "backend-data"),
    backendLogDir: path.join(portableRoot, "logs"),
  };
}

export function applyPortablePathOverrides(
  app: Pick<Electron.App, "setPath">,
  env: PortableEnv = process.env,
): PortableLayout | null {
  const layout = resolvePortableLayout(env);
  if (!layout) return null;

  for (const dir of [
    layout.portableRoot,
    layout.userDataDir,
    layout.configDir,
    layout.backendDataDir,
    layout.backendLogDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  migrateLegacyPortableState(layout, env);

  env.NIRS4ALL_PORTABLE_ROOT = layout.portableRoot;
  env.NIRS4ALL_CONFIG = layout.configDir;
  env.NIRS4ALL_BACKEND_DATA_DIR = layout.backendDataDir;
  env.NIRS4ALL_BACKEND_LOG_DIR = layout.backendLogDir;

  app.setPath("userData", layout.userDataDir);
  app.setPath("sessionData", path.join(layout.userDataDir, "sessionData"));

  return layout;
}
