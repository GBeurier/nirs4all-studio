/**
 * Contract between the Electron main process (owner of the Python environment
 * lifecycle) and the renderer. Type-only: imported by `electron/` and `src/`.
 *
 * Studio uses exactly one Python environment: the interpreter the user selected
 * or the one Studio created. Its state is derived from a package listing
 * (distribution metadata), never from import tests.
 */

/** `studio` is an environment created by Studio in its own data directory. */
export type PythonEnvKind = "studio" | "venv" | "conda" | "system";

/**
 * `editable` means the distribution is a development (editable) install that
 * is outside the required range; Studio never modifies editable installs.
 */
export type RequiredPackageStatus = "ok" | "missing" | "out_of_range" | "editable";

/** `older` means installed but below the recommended version. */
export type RecommendedPackageStatus = "ok" | "missing" | "older" | "unsupported_python";

/** A package Studio cannot run without. Installed and updated automatically. */
export interface RequiredPackageState {
  name: string;
  installedVersion: string | null;
  /** Accepted version specifier, e.g. `>=1.4.16,<1.5`; empty when any version is accepted. */
  requiredRange: string;
  /** Exact version Studio installs when the package is missing or out of range. */
  targetVersion: string;
  status: RequiredPackageStatus;
}

/** An optional package from the recommended catalogue. Installed only on request. */
export interface RecommendedPackageState {
  name: string;
  installedVersion: string | null;
  /** Lowest version the related features support, e.g. `>=2.1.0`. */
  minimum: string;
  recommendedVersion: string;
  /** Installed but below `minimum`. */
  belowMinimum: boolean;
  category: string;
  description: string;
  /** Preselected when Studio creates a new environment. */
  defaultInstall: boolean;
  status: RecommendedPackageStatus;
}

/** What a package listing says about one interpreter. */
export interface PythonEnvReport {
  pythonPath: string;
  envRoot: string;
  kind: PythonEnvKind;
  pythonVersion: string;
  /** False when Studio cannot install into it (read-only or externally managed). */
  writable: boolean;
  required: RequiredPackageState[];
  recommended: RecommendedPackageState[];
  /** Every required package is `ok`. */
  usable: boolean;
  /** Recommended packages with status `older`. Drives the warning and indicator dots. */
  outdatedRecommendedCount: number;
}

export type PythonEnvPhase =
  /** No environment has been selected, or the selected interpreter no longer exists. */
  | "unconfigured"
  /** The selected environment satisfies every required package. */
  | "ready"
  /** An installation, creation or switch is running. */
  | "busy"
  /** The selected environment exists but cannot be used; see `problem`. */
  | "needs_attention";

export type PythonEnvProblemCode =
  | "interpreter_missing"
  /** A required package is missing or out of range and Studio may not install it (read-only or editable). */
  | "required_not_installable"
  /** The automatic installation of required packages failed (offline, resolver conflict). */
  | "required_update_failed"
  /** Packages are in range but the scientific host did not start. */
  | "host_failed";

export interface PythonEnvProblem {
  code: PythonEnvProblemCode;
  /** English, user-facing; the renderer localises by `code` and shows this as detail. */
  message: string;
}

export interface PythonEnvActivity {
  kind: "creating" | "installing" | "updating_required" | "switching";
  /** 0-100, or null when the step has no measurable progress. */
  percent: number | null;
  detail: string;
}

export interface PythonEnvState {
  phase: PythonEnvPhase;
  /** Persisted interpreter path, kept even when the file is missing. */
  selectedPythonPath: string | null;
  /** Report of the selected environment; null when unconfigured or unreadable. */
  selected: PythonEnvReport | null;
  problem?: PythonEnvProblem;
  activity?: PythonEnvActivity;
  /** This installation carries the offline payload (Python archive and wheels). */
  offlineInstall: boolean;
}

/**
 * What Studio would install in an environment it creates: the pinned Python
 * version and every catalogue package evaluated against an empty environment
 * (`missing`, or `unsupported_python` for that Python version).
 */
export interface NewPythonEnvPlan {
  pythonVersion: string;
  required: RequiredPackageState[];
  recommended: RecommendedPackageState[];
}

export interface InspectPythonEnvResult {
  report?: PythonEnvReport;
  /** Set when the path is not a usable Python 3.11+ interpreter. */
  error?: string;
}

/** Switch to an existing interpreter. Required packages are always installed. */
export interface ApplyPythonEnvRequest {
  pythonPath: string;
  /** Recommended package names to install or bring to their recommended version. */
  packages: string[];
}

/** Create a Studio environment. Required packages are always installed. */
export interface CreatePythonEnvRequest {
  /** Parent directory; defaults to Studio's data directory. */
  directory?: string;
  packages: string[];
}

export interface PythonEnvActionResult {
  success: boolean;
  /** Failure reason. On failure the previous selection has been restored. */
  message?: string;
  state: PythonEnvState;
}

/** Exposed by the preload script as `window.electronApi.pythonEnv`. */
export interface PythonEnvApi {
  getState(): Promise<PythonEnvState>;
  /** List interpreters found on this machine, each with its report. */
  detect(refresh?: boolean): Promise<PythonEnvReport[]>;
  /** Inspect an interpreter path or an environment directory without changing anything. */
  inspect(path: string): Promise<InspectPythonEnvResult>;
  /** Describe the environment Studio would create; available without any Python installed. */
  describeNewEnvironment(): Promise<NewPythonEnvPlan>;
  /** Open a file dialog to choose a Python executable. */
  browse(): Promise<string | null>;
  /** Open a folder dialog to choose where a new environment is created. */
  chooseDirectory(): Promise<string | null>;
  apply(request: ApplyPythonEnvRequest): Promise<PythonEnvActionResult>;
  create(request: CreatePythonEnvRequest): Promise<PythonEnvActionResult>;
  /** Install or update recommended packages in the selected environment. */
  installPackages(packages: string[]): Promise<PythonEnvActionResult>;
  /** Re-run the startup check: install required packages if needed, then start the host. */
  retry(): Promise<PythonEnvActionResult>;
  /** Subscribe to state changes; returns the unsubscribe function. */
  onState(handler: (state: PythonEnvState) => void): () => void;
}
