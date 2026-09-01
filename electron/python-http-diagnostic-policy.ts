export const PYTHON_HTTP_DIAGNOSTIC_SWITCH =
  "enable-python-http-diagnostic" as const;
export const PYTHON_HTTP_DIAGNOSTIC_ENV =
  "NIRS4ALL_ENABLE_PYTHON_HTTP_DIAGNOSTIC" as const;

export interface PythonHttpDiagnosticPolicy {
  enabled: boolean;
  mode: "rust-only" | "python-http-diagnostic";
  source: "default" | "explicit-cli" | "explicit-dev-env";
  reason:
    | "python_http_disabled_by_default"
    | "explicit_cli_activation"
    | "explicit_dev_environment_activation";
}

export class PythonHttpDiagnosticDisabledError extends Error {
  readonly code = "STUDIO_PYTHON_HTTP_DIAGNOSTIC_DISABLED";
  readonly status = 501;

  constructor() {
    super(
      "Python HTTP diagnostic backend is disabled; this Studio session is Rust-only",
    );
    this.name = "PythonHttpDiagnosticDisabledError";
  }
}

export function requirePythonHttpDiagnostic(
  policy: PythonHttpDiagnosticPolicy,
): void {
  if (!policy.enabled) throw new PythonHttpDiagnosticDisabledError();
}

interface PolicyInputs {
  isPackaged: boolean;
  hasSwitch: (name: string) => boolean;
  environmentValue?: string;
}

/**
 * Resolve the process-wide renderer HTTP owner before any request is issued.
 *
 * A packaged build can only enable the transitional FastAPI diagnostic owner
 * through the visible command-line switch. Environment activation is limited
 * to development so a packaged product cannot silently inherit a Python HTTP
 * backend from its launch environment.
 */
export function resolvePythonHttpDiagnosticPolicy({
  isPackaged,
  hasSwitch,
  environmentValue,
}: PolicyInputs): PythonHttpDiagnosticPolicy {
  if (hasSwitch(PYTHON_HTTP_DIAGNOSTIC_SWITCH)) {
    return {
      enabled: true,
      mode: "python-http-diagnostic",
      source: "explicit-cli",
      reason: "explicit_cli_activation",
    };
  }

  if (!isPackaged && environmentValue === "1") {
    return {
      enabled: true,
      mode: "python-http-diagnostic",
      source: "explicit-dev-env",
      reason: "explicit_dev_environment_activation",
    };
  }

  return {
    enabled: false,
    mode: "rust-only",
    source: "default",
    reason: "python_http_disabled_by_default",
  };
}
