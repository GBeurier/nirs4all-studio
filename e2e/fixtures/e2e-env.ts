import * as path from 'path';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_BACKEND_PORT = 8765;
const DEFAULT_FRONTEND_PORT = 5174;

type Endpoint = {
  url: string;
  host: string;
  port: number;
};

export type E2eRuntimeConfig = {
  backendUrl: string;
  backendHost: string;
  backendPort: number;
  frontendUrl: string;
  frontendHost: string;
  frontendPort: number;
  runtimeRoot: string;
  configDir: string;
  portableRoot: string;
  reuseExistingServer: boolean;
};

function parsePort(rawValue: string | undefined, name: string, fallback: number): number {
  const value = rawValue?.trim();
  if (!value) {
    return fallback;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer port between 1 and 65535, got ${JSON.stringify(rawValue)}`);
  }
  return port;
}

function truthy(rawValue: string | undefined): boolean {
  const value = rawValue?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function endpointFromUrl(rawUrl: string, name: string): Endpoint {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error(`${name} must be an absolute HTTP URL, got ${JSON.stringify(rawUrl)}: ${error}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use http or https, got ${parsed.protocol}`);
  }

  const defaultPort = parsed.protocol === 'https:' ? 443 : 80;
  return {
    url: parsed.origin,
    host: parsed.hostname,
    port: parsePort(parsed.port || String(defaultPort), `${name} port`, defaultPort),
  };
}

function resolveEndpoint(
  env: NodeJS.ProcessEnv,
  urlName: string,
  hostName: string,
  portName: string,
  defaultPort: number,
): Endpoint {
  const explicitUrl = env[urlName]?.trim();
  if (explicitUrl) {
    return endpointFromUrl(explicitUrl, urlName);
  }

  const host = env[hostName]?.trim() || DEFAULT_HOST;
  const port = parsePort(env[portName], portName, defaultPort);
  return endpointFromUrl(`http://${host}:${port}`, `${hostName}/${portName}`);
}

function resolveLocalPath(rawValue: string | undefined, fallback: string, cwd: string): string {
  const value = rawValue?.trim();
  return path.resolve(cwd, value || fallback);
}

export function resolveE2eRuntimeConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): E2eRuntimeConfig {
  const backend = resolveEndpoint(
    env,
    'NIRS4ALL_E2E_BACKEND_URL',
    'NIRS4ALL_E2E_BACKEND_HOST',
    'NIRS4ALL_E2E_BACKEND_PORT',
    DEFAULT_BACKEND_PORT,
  );
  const frontend = resolveEndpoint(
    env,
    'NIRS4ALL_E2E_FRONTEND_URL',
    'NIRS4ALL_E2E_FRONTEND_HOST',
    'NIRS4ALL_E2E_FRONTEND_PORT',
    DEFAULT_FRONTEND_PORT,
  );
  const runtimeRoot = resolveLocalPath(env.NIRS4ALL_E2E_RUNTIME_ROOT, path.join('test-results', 'e2e-runtime'), cwd);

  return {
    backendUrl: backend.url,
    backendHost: backend.host,
    backendPort: backend.port,
    frontendUrl: frontend.url,
    frontendHost: frontend.host,
    frontendPort: frontend.port,
    runtimeRoot,
    configDir: resolveLocalPath(env.NIRS4ALL_E2E_CONFIG_DIR, path.join(runtimeRoot, 'config'), cwd),
    portableRoot: resolveLocalPath(env.NIRS4ALL_E2E_PORTABLE_ROOT, path.join(runtimeRoot, 'portable'), cwd),
    reuseExistingServer: !truthy(env.CI) && truthy(env.NIRS4ALL_E2E_REUSE_SERVER),
  };
}
