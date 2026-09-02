/**
 * Transitional source/dev Python HTTP runtime dependencies.
 *
 * This module is deliberately separate from python-runtime-config.cjs: the
 * latter is copied into packaged Electron products and must describe only the
 * bounded stdio plugin host. Nothing in the packaged Electron graph may import
 * this file.
 */
const BACKEND_COMMON_PACKAGES = Object.freeze([
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.34.0",
  "pydantic>=2.10.0",
  "python-multipart>=0.0.20",
  "httpx>=0.27.0",
  "pyyaml>=6.0",
  "packaging>=24.0",
  "platformdirs>=4.0.0",
  "sentry-sdk[fastapi]>=2.0.0",
  "orjson>=3.10.0",
  "msgpack>=1.0.0",
]);

const BACKEND_TRANSITION_TOOL_PACKAGES = Object.freeze([
  "nirs4all-tools>=0.0.5",
]);

module.exports = {
  BACKEND_COMMON_PACKAGES,
  BACKEND_TRANSITION_TOOL_PACKAGES,
};
