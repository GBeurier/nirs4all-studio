#!/usr/bin/env node
/** Live nginx + Rust access checks. No mocked HTTP server or science host.
 * Product image: node scripts/test-docker-access.cjs IMAGE
 * Transport-only local build: add --sidecar /absolute/path/studio-sidecar
 * (uses the production nginx image/config/entrypoint, not a packaged image).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const image = process.argv[2] || "nirs4all-studio:native-ci";
const sidecarIndex = process.argv.indexOf("--sidecar");
const sidecar = sidecarIndex < 0 ? null : path.resolve(process.argv[sidecarIndex + 1]);
const containers = [];
let temporary = null;
/** The renderer settles within a few seconds; a page still busy after this never will. */
const NETWORK_IDLE_TIMEOUT_MS = 30000;
const credential = "studio-access-test-password";
const authorization = `Basic ${Buffer.from(`tester:${credential}`).toString("base64")}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 30000 });
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function start(label, extra) {
  const name = `studio-access-${process.pid}-${label}`;
  containers.push(name);
  const args = ["run", "--detach", "--name", name, "--publish", "127.0.0.1::8000"];
  if (sidecar) {
    args.push("--user", "nginx", "--entrypoint", "/bin/sh",
      "--tmpfs", "/var/run/nginx:mode=1777", "--tmpfs", "/var/cache/nginx:mode=1777",
      "--tmpfs", "/config:mode=1777", "--env", "NIRS4ALL_CONFIG=/config",
      "--mount", `type=bind,src=${sidecar},dst=/opt/nirs4all/backend/native/studio-sidecar,readonly`,
      "--mount", `type=bind,src=${path.join(repo, "docker/nginx.conf")},dst=/etc/nginx/nginx.conf,readonly`,
      "--mount", `type=bind,src=${path.join(repo, "docker/entrypoint.sh")},dst=/studio-entrypoint,readonly`);
  }
  args.push(...extra, image);
  if (sidecar) args.push("/studio-entrypoint");
  docker(...args);
  return name;
}

async function baseUrl(name, headers = {}) {
  for (let attempt = 0; attempt < 360; attempt++) {
    const bindings = docker("port", name, "8000/tcp").trim();
    const port = bindings.match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (port) {
      const url = `http://127.0.0.1:${port}`;
      try {
        const response = await fetch(`${url}/api/health`, { headers, signal: AbortSignal.timeout(1500) });
        if (response.status === 200) return url;
      } catch { /* Wait for actual native startup, never retry a scientific job. */ }
    }
    if (docker("inspect", "--format", "{{.State.Running}}", name).trim() === "false") {
      throw new Error(`Container ${name} stopped: ${docker("logs", name)}`);
    }
    await pause(500);
  }
  throw new Error(`Native readiness timed out: ${docker("logs", name)}`);
}

function websocketStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${url}/ws?client_id=access-probe`, { headers: {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers,
    } });
    request.setTimeout(5000, () => request.destroy(new Error("WebSocket handshake timeout")));
    request.on("upgrade", (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    request.on("response", (response) => { response.resume(); resolve(response.statusCode); });
    request.on("error", reject);
    request.end();
  });
}

/** The browser's own account of the page's requests: those that failed, with its reason, and those still in flight. */
function trackBrowserRequests(page) {
  const describe = (request) => `${request.method()} ${new URL(request.url()).pathname}`;
  const pending = new Set();
  const failed = [];
  page.on("request", (request) => pending.add(request));
  page.on("requestfinished", (request) => pending.delete(request));
  page.on("requestfailed", (request) => {
    pending.delete(request);
    failed.push(`${describe(request)}: ${request.failure()?.errorText ?? "unknown"}`);
  });
  const list = (entries) => entries.join("; ") || "none recorded";
  return { failed: () => list(failed), pending: () => list([...pending].map(describe)) };
}

/** Authenticated navigation, fetch, JSON mutation and WebSocket from an actual page. */
async function browserAccessChecks(page, url, networkIdleTimeout = NETWORK_IDLE_TIMEOUT_MS) {
  // A probe that fails only says "Failed to fetch": keep the browser's own reason for every failed request.
  const requests = trackBrowserRequests(page);
  try {
    assert.equal((await page.goto(url)).status(), 200);
    // `goto` returns at the load event, when the renderer starts its own burst of API requests and opens
    // its WebSocket. The probes below are about access control, not about that startup: run them once
    // the page has no request in flight, so they never share connections with it.
    try {
      await page.waitForLoadState("networkidle", { timeout: networkIdleTimeout });
    } catch (error) {
      if (error.name !== "TimeoutError") throw error;
      throw new Error(`The page still had requests in flight after ${networkIdleTimeout} ms (network idle timed out). `
        + `Pending browser requests: ${requests.pending()}`, { cause: error });
    }
    assert.equal(await page.evaluate(() => fetch("/api/health").then((response) => response.status)), 200);
    assert.equal(await page.evaluate(() => fetch("/api/app/favorites", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline_id: "browser-auth-probe" }),
    }).then((response) => response.status)), 200);
    assert.equal(await page.evaluate(() => new Promise((resolve, reject) => {
      const socket = new WebSocket(`${location.origin.replace("http:", "ws:")}/ws`);
      const timeout = setTimeout(() => reject(new Error("Browser WebSocket timeout")), 5000);
      socket.onopen = () => { clearTimeout(timeout); socket.close(); resolve("connected"); };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error("Browser WebSocket refused")); };
    })), "connected");
  } catch (error) {
    // A new error: the stack of the original one was built with its first message, and the stack is what is printed.
    throw new Error(`${error.message}\nFailed browser requests: ${requests.failed()}`, { cause: error });
  }
}

async function main() {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-docker-access-"));
  const missing = start("missing", []);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (docker("inspect", "--format", "{{.State.Running}}", missing).trim() === "false") break;
    await pause(250);
  }
  assert.equal(docker("inspect", "--format", "{{.State.Running}}", missing).trim(), "false");
  assert.equal(docker("inspect", "--format", "{{.State.ExitCode}}", missing).trim(), "1");

  const local = start("local", ["--env", "NIRS4ALL_STUDIO_TRUSTED_LOCAL_ONLY=1"]);
  const localUrl = await baseUrl(local);
  assert.equal((await fetch(`${localUrl}/_studio_health`)).status, 403);
  assert.equal((await fetch(`${localUrl}/api/health`, { headers: { Origin: "https://untrusted.example" } })).status, 403);
  assert.equal(await websocketStatus(localUrl, { Origin: "https://untrusted.example" }), 403);
  assert.equal(await websocketStatus(localUrl, { Origin: localUrl }), 101);
  assert.equal(docker("exec", local, "curl", "--silent", "--output", "/dev/null", "--write-out", "%{http_code}",
    "http://127.0.0.1:8000/_studio_health").trim(), "200");

  const passwordFile = path.join(temporary, "htpasswd");
  // A fixed test credential only; production docs use interactive bcrypt.
  const hash = execFileSync("openssl", ["passwd", "-6", "-stdin"], { input: `${credential}\n`, encoding: "utf8" }).trim();
  fs.writeFileSync(passwordFile, `tester:${hash}\n`, { mode: 0o644 });
  fs.chmodSync(temporary, 0o755);
  const secured = start("secured", ["--mount", `type=bind,src=${passwordFile},dst=/run/secrets/studio.htpasswd,readonly`]);
  const securedUrl = await baseUrl(secured, { Authorization: authorization });
  for (const endpoint of ["/", "/api/health", "/api/app/favorites"]) {
    assert.equal((await fetch(`${securedUrl}${endpoint}`)).status, 401);
    assert.equal((await fetch(`${securedUrl}${endpoint}`, { headers: { Authorization: "Basic d3Jvbmc6d3Jvbmc=" } })).status, 401);
  }
  assert.equal((await fetch(`${securedUrl}/`, { headers: { Authorization: authorization } })).status, 200);
  assert.equal((await fetch(`${securedUrl}/api/app/favorites`, { method: "POST", headers: {
    Authorization: authorization, Origin: securedUrl, "Content-Type": "application/json",
  }, body: JSON.stringify({ pipeline_id: "docker-auth-probe" }) })).status, 200);
  assert.equal((await fetch(`${securedUrl}/api/app/favorites`, { method: "POST", headers: {
    Authorization: authorization, Origin: "https://untrusted.example", "Content-Type": "application/json",
  }, body: JSON.stringify({ pipeline_id: "forbidden-probe" }) })).status, 403);
  assert.equal(await websocketStatus(securedUrl, {}), 401);
  assert.equal(await websocketStatus(securedUrl, { Authorization: authorization, Origin: "https://untrusted.example" }), 403);
  assert.equal(await websocketStatus(securedUrl, { Authorization: authorization, Origin: securedUrl }), 101);
  assert.equal((await fetch(`${securedUrl}/_studio_health`, { headers: { Authorization: authorization } })).status, 403);
  if (process.argv.includes("--browser")) {
    const { chromium } = require("@playwright/test");
    const browser = await chromium.launch({ headless: true,
      executablePath: process.env.NIRS4ALL_TEST_CHROMIUM_PATH || undefined });
    try {
      const context = await browser.newContext({ httpCredentials: { username: "tester", password: credential } });
      await browserAccessChecks(await context.newPage(), securedUrl);
      console.log("PASS actual Chromium authenticated navigation, fetch, JSON mutation and WebSocket");
    } finally {
      await browser.close();
    }
  }
  console.log(`PASS Docker access: default refusal; explicit local mode; authenticated SPA/HTTP/WS; cross-origin and public health refusal (${sidecar ? "transport-only build" : "product image"})`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => {
    for (const name of containers) {
      try { docker("rm", "--force", name); } catch { /* Only test-owned containers. */ }
    }
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  });
}

module.exports = { browserAccessChecks };
