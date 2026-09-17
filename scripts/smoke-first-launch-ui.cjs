/** Real packaged renderer: first setup, developer preference, reload, restart. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("node:net");
const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const archive = require("./smoke-archive-standalone.cjs");

const SECRET_FIELD = /authorization|cookie|password|secret|token|api[_-]?key|credential|headers/i;

function diagnosticUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

function sanitizeDiagnostic(value, secrets = [], limit = 1500) {
  let text = String(value);
  try {
    text = JSON.stringify(JSON.parse(text), (key, entry) => SECRET_FIELD.test(key) ? "[redacted]" : entry);
  } catch { /* Plain-text errors still pass through the redaction below. */ }
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  text = text.replace(/https?:\/\/[^\s"'<>]+/g, diagnosticUrl)
    .replace(/\b(Bearer|Basic)\s+[^\s,"'<>]+/gi, "$1 [redacted]")
    .replace(/((?:[\w-]*(?:authorization|cookie|password|secret|token|api[_-]?key|credential)[\w-]*)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, "$1[redacted]");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

async function withDiagnosticTimeout(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise(resolve => { timer = setTimeout(() => resolve("[body unavailable after 1000ms]"), 1000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function recordHttpFailure(response, record, sanitize) {
  if (response.status() < 400) return;
  const summary = `HTTP ${response.status()} ${response.request().method()} ${diagnosticUrl(response.url())}`;
  record(summary);
  try {
    const body = await withDiagnosticTimeout(response.text());
    record(`${summary} body: ${sanitize(body)}`);
  } catch (error) {
    record(`${summary} body unavailable: ${sanitize(error.message)}`);
  }
}

/** Observe setup without clicking Retry or accepting a partial runtime. */
async function waitForSetupState(page, isReady, timeoutMs, description, sanitize = sanitizeDiagnostic) {
  const deadline = Date.now() + timeoutMs;
  const setupAlerts = page.locator(".bg-card")
    .filter({ has: page.getByRole("button", { name: "Retry verification", exact: true }) }).getByRole("alert");
  while (Date.now() < deadline) {
    for (const alert of await setupAlerts.all()) {
      if (await alert.isVisible()) {
        const message = await alert.textContent({ timeout: Math.max(1, Math.min(1000, deadline - Date.now())) });
        throw new Error(`First setup failed: ${sanitize(message || "Visible error alert")}`);
      }
    }
    if (await isReady()) return;
    await page.waitForTimeout(Math.min(200, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const config = archive.assertValidConfig(archive.parseArgs());
  const layout = archive.resolveLaunchLayout(config.extractedRoot, config.platform, config.appName);
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "studio-first-launch-ui-"));
  const env = archive.buildSandboxEnv(config.platform, sandbox, await freePort(), config.timeoutMs);
  env.SENTRY_DSN = "";
  let app;
  const errors = [];
  const diagnostics = [];
  const pendingDiagnostics = new Set();
  const secrets = Object.entries(env).filter(([key]) => SECRET_FIELD.test(key)).map(([, value]) => value);
  const sanitize = value => sanitizeDiagnostic(value, secrets);
  const record = message => {
    diagnostics.push(sanitize(message));
    if (diagnostics.length > 40) diagnostics.shift();
  };
  const launch = async () => {
    app = await electron.launch({
      executablePath: layout.executablePath,
      args: config.platform === "linux" ? ["--no-sandbox"] : [],
      cwd: layout.appRoot,
      env,
      timeout: config.timeoutMs,
    });
    app.process().stderr.on("data", chunk => record(`Electron: ${chunk}`));
    // The splash can be the first window on a cold restart. Select the
    // privileged Studio renderer rather than racing a soon-to-close splash.
    let page;
    await expect.poll(async () => {
      for (const candidate of app.windows()) {
        try {
          if (await candidate.evaluate(() => Boolean(window.electronApi?.isElectron))) {
            page = candidate;
            return true;
          }
        } catch { /* A splash or navigation may disappear during inspection. */ }
      }
      return false;
    }, { timeout: config.timeoutMs }).toBe(true);
    page.setDefaultTimeout(config.timeoutMs);
    page.setDefaultNavigationTimeout(config.timeoutMs);
    page.on("console", message => { if (message.type() === "error") record(`Console: ${message.text()}`); });
    page.on("requestfailed", request => record(`Request: ${request.method()} ${diagnosticUrl(request.url())} ${request.failure()?.errorText}`));
    page.on("response", response => {
      const pending = recordHttpFailure(response, record, sanitize)
        .catch(error => record(`HTTP diagnostic unavailable: ${sanitize(error.message)}`));
      pendingDiagnostics.add(pending);
      void pending.finally(() => pendingDiagnostics.delete(pending));
    });
    page.on("pageerror", error => { errors.push(sanitize(error.message)); if (errors.length > 20) errors.shift(); });
    return page;
  };
  const openAdvanced = async page => {
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Advanced", exact: true }).click();
    return page.getByRole("tabpanel").getByRole("switch").first();
  };
  console.log(`First-launch UI sandbox: ${sandbox}`);
  try {
    const page = await launch();
    await page.getByRole("button", { name: "Do not send", exact: true }).click({ timeout: config.timeoutMs });
    await waitForSetupState(page,
      () => page.getByText("The included CPU runtime and required packages are ready.", { exact: true }).isVisible(),
      config.timeoutMs, "the included CPU runtime and required packages to be ready", sanitize);
    await page.getByRole("button", { name: "Open Studio", exact: true }).click();
    await waitForSetupState(page, () => /\/datasets(?:[?#]|$)/.test(page.url()),
      config.timeoutMs, "setup completion and the datasets page", sanitize);
    console.log("First setup verified bundled packages and opened datasets without skipping setup.");

    const toggle = await openAdvanced(page);
    await expect(toggle).toBeEnabled({ timeout: config.timeoutMs });
    const saveStarted = Date.now();
    await toggle.check();
    // Read the actual stored preference; optimistic switch state is not proof.
    await expect.poll(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_NATIVE_SIDECAR_PORT}/api/app/settings`, {
          headers: { "X-Nirs4all-Session": env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          record(`Preference poll: HTTP ${response.status} after ${Date.now() - saveStarted}ms`);
          return false;
        }
        return (await response.json()).ui_preferences?.developer_mode === true;
      } catch (error) {
        record(`Preference poll: ${error.message} after ${Date.now() - saveStarted}ms`);
        return false;
      }
    }, { timeout: config.timeoutMs }).toBe(true);
    console.log(`Developer preference persisted after ${Date.now() - saveStarted}ms.`);

    await page.reload();
    const reloadedToggle = await openAdvanced(page);
    await expect(reloadedToggle).toHaveAttribute("aria-checked", "true", { timeout: config.timeoutMs });
    console.log("Developer mode saved without a workspace and survived renderer reload.");

    await app.close();
    app = undefined;
    const restarted = await launch();
    const restartedToggle = await openAdvanced(restarted);
    await expect(restartedToggle).toHaveAttribute("aria-checked", "true", { timeout: config.timeoutMs });
    console.log("First-launch UI smoke passed: installed runtime, setup, Settings, saved preference, reload and app restart.");
  } catch (error) {
    await withDiagnosticTimeout(Promise.allSettled([...pendingDiagnostics]));
    console.error("Renderer errors:", errors.join("\n") || "none");
    console.error("Recent transport diagnostics:", diagnostics.join("\n") || "none");
    if (app) {
      for (const page of app.windows()) {
        console.error("Current page:", diagnosticUrl(page.url()));
        console.error(sanitizeDiagnostic(await page.locator("body").innerText({ timeout: 1000 }).catch(() => ""), secrets, 8000));
      }
    }
    throw new Error(sanitizeDiagnostic(error.stack || error, secrets, 8000));
  } finally {
    if (app) await app.close();
    if (!config.keepSandbox) await archive.cleanupSandboxRoot(sandbox);
  }
}

module.exports = { diagnosticUrl, sanitizeDiagnostic, recordHttpFailure, waitForSetupState };

if (require.main === module) {
  main().catch(error => { console.error("First-launch UI smoke failed:", sanitizeDiagnostic(error.stack || error)); process.exitCode = 1; });
}
