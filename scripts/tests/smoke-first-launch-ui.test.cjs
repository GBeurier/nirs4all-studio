const assert = require("node:assert/strict");
const { test } = require("node:test");
const { diagnosticUrl, sanitizeDiagnostic, recordHttpFailure, waitForSetupState } = require("../smoke-first-launch-ui.cjs");

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

function setupPage(onWait = () => {}) {
  const state = { ready: false, alert: null, visible: true, waits: 0, outsideAlert: null };
  const retry = {};
  return {
    state,
    getByRole: (role, options) => {
      if (role === "alert") return { all: async () => [state.alert, state.outsideAlert].filter(Boolean).map(message => ({
        isVisible: async () => true, textContent: async () => message,
      })) };
      assert.equal(role, "button");
      assert.deepEqual(options, { name: "Retry verification", exact: true });
      return retry;
    },
    locator: selector => {
      assert.equal(selector, ".bg-card");
      return { filter: ({ has }) => {
        assert.equal(has, retry);
        return { getByRole: role => {
          assert.equal(role, "alert");
          return { all: async () => state.alert === null ? [] : [{
            isVisible: async () => state.visible,
            textContent: async () => state.alert,
          }] };
        } };
      } };
    },
    waitForTimeout: async () => { state.waits += 1; onWait(state); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test("a setup error appearing during runtime verification fails promptly despite the ten-minute timeout", { timeout: 1000 }, async () => {
  const page = setupPage(state => { state.alert = "Native service unavailable: session-value"; });
  await assert.rejects(waitForSetupState(page, () => page.state.ready, 600000, "runtime ready",
    value => sanitizeDiagnostic(value, ["session-value"])), /First setup failed: Native service unavailable: \[redacted\]/);
  assert.equal(page.state.waits, 1);
});

test("a visible setup error wins even if a previous ready indication remains", async () => {
  const page = setupPage();
  page.state.alert = "Failed to save setup completion";
  await assert.rejects(waitForSetupState(page, () => true, 600000, "datasets"), /Failed to save setup completion/);
});

test("setup succeeds only once the required ready predicate is true and ignores hidden alerts", async () => {
  const page = setupPage(state => { state.ready = state.waits >= 3; });
  page.state.alert = "Hidden previous error";
  page.state.visible = false;
  await waitForSetupState(page, () => page.state.ready, 1000, "runtime ready");
  assert.equal(page.state.waits, 3);
});

test("absence of errors cannot bypass runtime readiness", async () => {
  const page = setupPage();
  await assert.rejects(waitForSetupState(page, () => false, 10, "runtime ready"), /Timed out waiting for runtime ready/);
});

test("alerts outside the installation verification card do not fail setup", async () => {
  const page = setupPage(state => { state.ready = true; });
  page.state.outsideAlert = "An update is available";
  await waitForSetupState(page, () => page.state.ready, 1000, "runtime ready");
  assert.equal(page.state.waits, 1);
});
