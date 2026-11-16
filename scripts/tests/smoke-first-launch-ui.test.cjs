const assert = require("node:assert/strict");
const { test } = require("node:test");
const { diagnosticUrl, sanitizeDiagnostic, recordHttpFailure, waitForSelectedEnvironment } = require("../smoke-first-launch-ui.cjs");

test("transport diagnostics omit URL credentials, query values and fragments", () => {
  assert.equal(diagnosticUrl("http://user:password@127.0.0.1:8000/api/system/readiness?session=private#secret"),
    "http://127.0.0.1:8000/api/system/readiness");
  assert.equal(diagnosticUrl("not a URL with private data"), "[invalid URL]");
});

test("error bodies redact nested credentials and known session tokens before truncation", () => {
  const body = JSON.stringify({
    detail: "runtime blocked with session-value; see https://user:pass@example.com/check?key=private",
    token: "private-token", nested: [{ api_key: "private-key", headers: { arbitrary: "private-header" } }],
  });
  const result = sanitizeDiagnostic(body, ["session-value"]);
  assert.match(result, /runtime blocked/);
  for (const secret of ["session-value", "private", "user", "pass"]) assert(!result.includes(secret), result);
  const bounded = sanitizeDiagnostic(`Failure ${"x".repeat(30)}secret-value ${"y".repeat(100)}`, ["secret-value"], 50);
  assert.equal(bounded.length, 50);
  assert(!bounded.includes("secret-value"));
});

test("plain text error bodies redact bearer tokens and password assignments", () => {
  const result = sanitizeDiagnostic('Failed Authorization: Bearer bearer-value; password="password-value" token=token-value; Basic basic-value');
  for (const secret of ["bearer-value", "password-value", "token-value", "basic-value"]) assert(!result.includes(secret), result);
});

test("HTTP failure diagnostics include method, status, safe URL and bounded error body without reading headers", async () => {
  const messages = [];
  await recordHttpFailure({
    status: () => 503,
    request: () => ({ method: () => "GET", headers: () => { throw Error("Do not read headers"); } }),
    url: () => "http://127.0.0.1/api/system/readiness?token=private",
    text: async () => JSON.stringify({ detail: `Runtime unavailable ${"x".repeat(3000)}`, session_token: "private" }),
    headers: () => { throw Error("Do not read headers"); },
  }, value => messages.push(value), sanitizeDiagnostic);
  assert.equal(messages[0], "HTTP 503 GET http://127.0.0.1/api/system/readiness");
  assert.match(messages[1], /body:.*Runtime unavailable/);
  assert(!messages.join("\n").includes("private"));
  assert(messages[1].length < 1600);
});

test("successful HTTP bodies are not collected and unreadable failures retain HTTP context", async () => {
  const messages = [];
  await recordHttpFailure({ status: () => 200, text: () => { throw Error("Do not read success bodies"); } },
    value => messages.push(value), sanitizeDiagnostic);
  assert.deepEqual(messages, []);
  await recordHttpFailure({
    status: () => 500, request: () => ({ method: () => "POST" }), url: () => "http://127.0.0.1/api/setup",
    text: async () => { throw Error("Response body discarded"); },
  }, value => messages.push(value), sanitizeDiagnostic);
  assert.match(messages[1], /HTTP 500 POST .*body unavailable: Response body discarded/);
});

test("an unfinished HTTP error body cannot hold diagnostic collection beyond one second", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const messages = [];
  const pending = recordHttpFailure({
    status: () => 503, request: () => ({ method: () => "GET" }), url: () => "http://127.0.0.1/api/system/readiness",
    text: () => new Promise(() => {}),
  }, value => messages.push(value), sanitizeDiagnostic);
  t.mock.timers.tick(1000);
  await pending;
  assert.match(messages[1], /body unavailable after 1000ms/);
});

function environmentPage(states) {
  const page = { waits: 0,
    evaluate: async () => states[Math.min(page.waits, states.length - 1)],
    waitForTimeout: async () => { page.waits += 1; await new Promise(resolve => setImmediate(resolve)); } };
  return page;
}
const python = "/data/python-env/venv/bin/python";

test("the provisioned environment is accepted only once Studio reports it ready", async () => {
  const page = environmentPage([
    { phase: "busy", selectedPythonPath: python }, { phase: "busy", selectedPythonPath: python },
    { phase: "ready", selectedPythonPath: python },
  ]);
  assert.equal((await waitForSelectedEnvironment(page, python, 1000)).phase, "ready");
  assert.equal(page.waits, 2);
});

test("an unusable environment fails at once with its redacted reason despite a ten-minute timeout", { timeout: 1000 }, async () => {
  const page = environmentPage([{ phase: "needs_attention", selectedPythonPath: python,
    problem: { code: "host_failed", message: "Host refused session-value" } }]);
  await assert.rejects(waitForSelectedEnvironment(page, python, 600000, value => sanitizeDiagnostic(value, ["session-value"])),
    /not usable: host_failed: Host refused \[redacted\]/);
  assert.equal(page.waits, 0);
});

test("another selection or an unconfigured application is refused", async () => {
  await assert.rejects(waitForSelectedEnvironment(environmentPage([{ phase: "ready", selectedPythonPath: "/usr/bin/python3" }]), python, 1000),
    /instead of the provisioned environment/);
  await assert.rejects(waitForSelectedEnvironment(environmentPage([{ phase: "unconfigured", selectedPythonPath: null }]), python, 1000),
    /instead of the provisioned environment/);
});

test("an environment that never becomes ready times out", async () => {
  await assert.rejects(waitForSelectedEnvironment(environmentPage([{ phase: "busy", selectedPythonPath: python }]), python, 10),
    /Timed out waiting for the Python environment \(phase busy\)/);
});
