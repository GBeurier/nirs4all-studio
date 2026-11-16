const test = require("node:test");
const assert = require("node:assert/strict");
const { inspect } = require("node:util");
const { browserAccessChecks } = require("../test-docker-access.cjs");

const request = (method, pathname, errorText) => ({
  method: () => method, url: () => `http://127.0.0.1:8000${pathname}`, failure: () => ({ errorText }),
});

/** A page whose requests are reported as the browser reports them, and whose checks fail where `fail` says. */
function page(fail) {
  const listeners = {};
  const emit = (event, value) => listeners[event](value);
  return {
    on: (event, listener) => { listeners[event] = listener; },
    goto: async () => {
      const health = request("GET", "/api/health");
      const settings = request("GET", "/api/app/settings", "net::ERR_CONNECTION_RESET");
      const readiness = request("GET", "/api/system/readiness");
      for (const sent of [health, settings, readiness]) emit("request", sent);
      emit("requestfinished", health);
      emit("requestfailed", settings);
      return { status: () => 200 };
    },
    waitForLoadState: async (state, options) => {
      assert.equal(state, "networkidle");
      assert.equal(options.timeout, 1234);
      if (fail === "idle") throw Object.assign(new Error("page.waitForLoadState: Timeout 1234ms exceeded."), { name: "TimeoutError" });
    },
    evaluate: async () => { throw new TypeError("Failed to fetch"); },
  };
}

test("a failed browser probe prints the requests the browser reported as failed", async () => {
  const error = await browserAccessChecks(page("probe"), "http://127.0.0.1:8000", 1234).catch((caught) => caught);
  assert.equal(error.cause.message, "Failed to fetch");
  // `console.error` prints the inspected error, hence its stack: the detail must be there, not only in `message`.
  for (const printed of [error.stack, inspect(error)]) {
    assert.match(printed, /Failed to fetch\nFailed browser requests: GET \/api\/app\/settings: net::ERR_CONNECTION_RESET/);
  }
});

test("a page that never becomes idle fails with the timeout and the requests still in flight", async () => {
  const error = await browserAccessChecks(page("idle"), "http://127.0.0.1:8000", 1234).catch((caught) => caught);
  assert.match(error.stack, /still had requests in flight after 1234 ms \(network idle timed out\)/);
  assert.match(error.stack, /Pending browser requests: GET \/api\/system\/readiness\n/);
  assert.match(error.stack, /Failed browser requests: GET \/api\/app\/settings: net::ERR_CONNECTION_RESET/);
});
