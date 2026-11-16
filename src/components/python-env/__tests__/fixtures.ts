import { vi } from "vitest";
import type {
  NewPythonEnvPlan,
  PythonEnvActionResult,
  PythonEnvApi,
  PythonEnvReport,
  PythonEnvState,
  RecommendedPackageState,
  RequiredPackageState,
} from "@/types/pythonEnvironment";

export function requiredPackage(overrides: Partial<RequiredPackageState> = {}): RequiredPackageState {
  return {
    name: "nirs4all",
    installedVersion: "1.4.16",
    requiredRange: ">=1.4.16,<1.5",
    targetVersion: "1.4.16",
    status: "ok",
    ...overrides,
  };
}

export function recommendedPackage(overrides: Partial<RecommendedPackageState> = {}): RecommendedPackageState {
  return {
    name: "xgboost",
    installedVersion: "3.0.0",
    minimum: ">=2.0.0",
    recommendedVersion: "3.0.0",
    belowMinimum: false,
    category: "boosting",
    description: "XGBoost gradient boosting framework",
    defaultInstall: true,
    status: "ok",
    ...overrides,
  };
}

/** A report whose derived fields follow its packages unless overridden. */
export function envReport(overrides: Partial<PythonEnvReport> = {}): PythonEnvReport {
  const required = overrides.required ?? [requiredPackage(), requiredPackage({ name: "nirs4all-core", installedVersion: "0.5.0", requiredRange: "", targetVersion: "0.5.0" })];
  const recommended = overrides.recommended ?? [
    recommendedPackage(),
    recommendedPackage({ name: "torch", installedVersion: null, recommendedVersion: "2.6.0", category: "deep_learning", description: "PyTorch deep learning framework", status: "missing" }),
    recommendedPackage({ name: "shap", installedVersion: "0.44.0", recommendedVersion: "0.47.1", category: "explainability", description: "SHAP explanations", defaultInstall: false, status: "older" }),
    recommendedPackage({ name: "autogluon", installedVersion: null, recommendedVersion: "1.2.0", category: "automl", description: "AutoGluon AutoML toolkit", defaultInstall: false, status: "unsupported_python" }),
  ];
  return {
    pythonPath: "/home/ada/venvs/nirs/bin/python",
    envRoot: "/home/ada/venvs/nirs",
    kind: "venv",
    pythonVersion: "3.13.1",
    writable: true,
    usable: required.every((pkg) => pkg.status === "ok"),
    outdatedRecommendedCount: recommended.filter((pkg) => pkg.status === "older").length,
    ...overrides,
    required,
    recommended,
  };
}

export function envState(overrides: Partial<PythonEnvState> = {}): PythonEnvState {
  const selected = overrides.selected === undefined ? envReport() : overrides.selected;
  return {
    phase: "ready",
    selectedPythonPath: selected?.pythonPath ?? null,
    offlineInstall: false,
    ...overrides,
    selected,
  };
}

/** What Studio would install in an environment it creates. */
export function newEnvPlan(overrides: Partial<NewPythonEnvPlan> = {}): NewPythonEnvPlan {
  return {
    pythonVersion: "3.11.9",
    required: [requiredPackage({ installedVersion: null, status: "missing" })],
    recommended: [
      recommendedPackage({ installedVersion: null, status: "missing" }),
      recommendedPackage({ name: "torch", installedVersion: null, recommendedVersion: "2.6.0", category: "deep_learning", description: "PyTorch deep learning framework", status: "missing" }),
      recommendedPackage({ name: "shap", installedVersion: null, recommendedVersion: "0.47.1", category: "explainability", description: "SHAP explanations", defaultInstall: false, status: "missing" }),
      recommendedPackage({ name: "tabpfn", installedVersion: null, recommendedVersion: "2.0.3", category: "deep_learning", description: "TabPFN tabular data model", status: "unsupported_python" }),
    ],
    ...overrides,
  };
}

export const unconfiguredState = (): PythonEnvState => envState({ phase: "unconfigured", selected: null, selectedPythonPath: null });

export type PythonEnvApiMock = { [K in keyof PythonEnvApi]: ReturnType<typeof vi.fn<PythonEnvApi[K]>> } & {
  /** Pushes a state to the subscribers, as the main process does. */
  emit: (state: PythonEnvState) => void;
};

/** `window.electronApi.pythonEnv` double; actions succeed with `initial` unless overridden. */
export function mockPythonEnvApi(initial: PythonEnvState, detected: PythonEnvReport[] = []): PythonEnvApiMock {
  const listeners = new Set<(state: PythonEnvState) => void>();
  const done = async (): Promise<PythonEnvActionResult> => ({ success: true, state: initial });
  return {
    getState: vi.fn<PythonEnvApi["getState"]>(async () => initial),
    detect: vi.fn<PythonEnvApi["detect"]>(async () => detected),
    inspect: vi.fn<PythonEnvApi["inspect"]>(async () => ({ error: "Not a Python interpreter" })),
    describeNewEnvironment: vi.fn<PythonEnvApi["describeNewEnvironment"]>(async () => newEnvPlan()),
    browse: vi.fn<PythonEnvApi["browse"]>(async () => null),
    chooseDirectory: vi.fn<PythonEnvApi["chooseDirectory"]>(async () => null),
    apply: vi.fn<PythonEnvApi["apply"]>(done),
    create: vi.fn<PythonEnvApi["create"]>(done),
    installPackages: vi.fn<PythonEnvApi["installPackages"]>(done),
    retry: vi.fn<PythonEnvApi["retry"]>(done),
    onState: vi.fn<PythonEnvApi["onState"]>((handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    }),
    emit: (state) => listeners.forEach((listener) => listener(state)),
  };
}

/** Installs the double as the desktop preload surface; returns the restore function. */
export function installPythonEnvApi(api: PythonEnvApiMock): () => void {
  const previous = window.electronApi;
  window.electronApi = { isElectron: true, platform: "linux", pythonEnv: api } as unknown as Window["electronApi"];
  return () => {
    window.electronApi = previous;
  };
}
