/** Diagnose a cold packaged setup. A successful manual retry is not qualification. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("node:net");
const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const archive = require("./smoke-archive-standalone.cjs");

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output-root");
  if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error("--output-root is required");
  const output = path.resolve(args[outputIndex + 1]);
  args.splice(outputIndex, 2);
  const config = archive.assertValidConfig(archive.parseArgs(args));
  fs.mkdirSync(output, { recursive: true });
  const layout = archive.resolveLaunchLayout(config.extractedRoot, config.platform, config.appName);
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "studio-setup-diagnostic-"));
  const env = archive.buildSandboxEnv(config.platform, sandbox, port, config.timeoutMs);
  env.SENTRY_DSN = "";
  const safeUrl = value => {
    try {
      const url = new URL(value);
      url.username = "";
      url.password = "";
      const allowed = new Set(["profile", "include_optional", "include_latest", "force_refresh"]);
      for (const key of [...url.searchParams.keys()]) {
        if (!allowed.has(key)) url.searchParams.set(key, "[redacted]");
      }
      return url.href;
    } catch { return value; }
  };
  const redact = value => value.replaceAll(env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN, "[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/g, safeUrl);
  const serialize = (value, indent) => JSON.stringify(value, (_key, item) => typeof item === "string" ? redact(item) : item, indent);
  const writeResult = () => fs.writeFileSync(path.join(output, "result.json"), serialize(result, 2) + "\n");
  const start = Date.now();
  let phase = "automatic-first-setup";
  let app;
  let page;
  let recordedBytes = 0;
  const pending = new Set();
  const observedPages = new WeakSet();
  const requests = new WeakMap();
  const result = { diagnostic_only: true, qualifies_automatic_setup: false, sandbox,
    automatic_setup: null, manual_retry: null, runtime_snapshots: [] };
  const record = entry => {
    if (recordedBytes >= 4 * 1024 * 1024) return;
    const line = serialize({ elapsed_ms: Date.now() - start, phase, ...entry }) + "\n";
    recordedBytes += Buffer.byteLength(line);
    fs.appendFileSync(path.join(output, "events.jsonl"), line);
  };
  const watch = candidate => {
    if (observedPages.has(candidate)) return;
    observedPages.add(candidate);
    candidate.on("console", message => record({ kind: "console", type: message.type(), text: message.text().slice(0, 4000) }));
    candidate.on("pageerror", error => record({ kind: "pageerror", text: String(error).slice(0, 4000) }));
    candidate.on("request", request => {
      requests.set(request, { started_ms: Date.now() - start, phase });
      if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(request.url())) {
        record({ kind: "request", method: request.method(), url: request.url() });
      }
    });
    candidate.on("requestfailed", request => record({ kind: "requestfailed", method: request.method(), url: request.url(), error: request.failure() }));
    candidate.on("response", response => {
      const responsePhase = requests.get(response.request())?.phase ?? phase;
      const task = (async () => {
        const request = response.request();
        const entry = { kind: "response", request_phase: responsePhase, started_ms: requests.get(request)?.started_ms,
          response_ms: Date.now() - start, method: request.method(), url: response.url(), status: response.status() };
        record(entry);
        // Error bodies identify timeout, unavailable-host and configuration refusals.
        if (response.status() >= 400 && /^http:\/\/(127\.0\.0\.1|localhost):/.test(response.url())) {
          entry.body = (await response.text().catch(error => String(error))).slice(0, 8000);
        }
        await response.finished().catch(() => {});
        entry.timing = request.timing();
        record({ ...entry, kind: "response-finished", finished_ms: Date.now() - start });
      })().catch(error => record({ kind: "response-capture-error", error: String(error) }));
      pending.add(task);
      task.finally(() => pending.delete(task));
    });
  };
  const snapshot = async label => {
    writeResult();
    if (page) {
      fs.writeFileSync(path.join(output, `${label}.txt`), redact(await page.locator("body").innerText().catch(String)));
      await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: true, timeout: 10000 }).catch(error => record({ kind: "screenshot-error", error: String(error) }));
    }
  };
  const runtimeSnapshot = async () => {
    const snapshots = await Promise.all(["/api/health", "/api/system/readiness", "/api/system/env-coherence", "/api/updates/dependencies?force_refresh=true", "/api/config/diff?profile=cpu&include_latest=false"].map(async route => {
      const began = Date.now();
      try {
        const response = await fetch(`http://127.0.0.1:${port}${route}`, {
          headers: { "X-Nirs4all-Session": env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN },
          signal: AbortSignal.timeout(20000),
        });
        return { route, status: response.status, body: (await response.text()).slice(0, 16000), elapsed_ms: Date.now() - began };
      } catch (error) { return { route, error: String(error), elapsed_ms: Date.now() - began }; }
    }));
    result.runtime_snapshots.push({ label: "after-setup-attempts", snapshots });
    writeResult();
  };
  const terminalSetup = async timeout => {
    let state;
    await expect.poll(async () => {
      if (await page.getByText("The included CPU runtime and required packages are ready.", { exact: true }).isVisible()) {
        state = { ready: true, elapsed_ms: Date.now() - start }; return true;
      }
      const error = page.getByRole("alert").filter({ hasNot: page.getByRole("button") }).first();
      const retry = page.getByRole("button", { name: "Retry verification", exact: true });
      if (await retry.isVisible() && await retry.isEnabled() && await error.isVisible()) {
        state = { ready: false, error: await error.innerText({ timeout: 1000 }).catch(() => "Runtime verification failed"), elapsed_ms: Date.now() - start }; return true;
      }
      return false;
    }, { timeout }).toBe(true);
    return state;
  };
  try {
    // No readiness probe or wait before the first actual renderer launch.
    app = await electron.launch({ executablePath: layout.executablePath, cwd: layout.appRoot,
      args: config.platform === "linux" ? ["--no-sandbox"] : [], env, timeout: config.timeoutMs });
    app.process().stderr.on("data", chunk => record({ kind: "electron-stderr", text: String(chunk).slice(0, 12000) }));
    app.process().stdout.on("data", chunk => record({ kind: "electron-stdout", text: String(chunk).slice(0, 12000) }));
    app.on("window", watch);
    app.windows().forEach(watch);
    await expect.poll(async () => {
      for (const candidate of app.windows()) {
        if (await candidate.evaluate(() => Boolean(window.electronApi?.isElectron)).catch(() => false)) { page = candidate; return true; }
      }
      return false;
    }, { timeout: config.timeoutMs }).toBe(true);
    page.setDefaultTimeout(config.timeoutMs);
    await page.getByRole("button", { name: "Do not send", exact: true }).click();
    result.automatic_setup = await terminalSetup(config.timeoutMs);
    await snapshot("automatic-setup");
    if (!result.automatic_setup.ready) {
      // Preserve the automatic failure even when the explicit retry recovers.
      process.exitCode = 1;
      phase = "single-manual-retry-diagnostic-only";
      record({ kind: "manual-retry", count: 1 });
      await page.getByRole("button", { name: "Retry verification", exact: true }).click();
      result.manual_retry = await terminalSetup(config.timeoutMs);
      await snapshot("after-single-manual-retry");
    }
    // Probes can warm caches: keep them after both actual UI attempts.
    phase = "post-attempt-runtime-probes";
    await runtimeSnapshot();
  } catch (error) {
    result.harness_error = String(error);
    await snapshot("harness-error");
    process.exitCode = 1;
  } finally {
    if (app) {
      try { await app.close(); }
      catch (error) { record({ kind: "close-error", error: String(error) }); process.exitCode = 1; }
    }
    await Promise.race([Promise.allSettled([...pending]), new Promise(resolve => setTimeout(resolve, 3000))]);
    result.elapsed_ms = Date.now() - start;
    writeResult();
    console.log(serialize(result, 2));
    if (!config.keepSandbox) await archive.cleanupSandboxRoot(sandbox);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
