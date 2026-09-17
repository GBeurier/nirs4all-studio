/** Real packaged renderer: first setup, developer preference, reload, restart. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("node:net");
const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const archive = require("./smoke-archive-standalone.cjs");

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
  const launch = async () => {
    app = await electron.launch({
      executablePath: layout.executablePath,
      args: config.platform === "linux" ? ["--no-sandbox"] : [],
      cwd: layout.appRoot,
      env,
      timeout: config.timeoutMs,
    });
    const page = await app.firstWindow({ timeout: config.timeoutMs });
    page.on("pageerror", error => { errors.push(error.message); if (errors.length > 20) errors.shift(); });
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
    await page.getByText("The included CPU runtime and required packages are ready.", { exact: true })
      .waitFor({ timeout: config.timeoutMs });
    await page.getByRole("button", { name: "Open Studio", exact: true }).click();
    await page.waitForURL("**/datasets", { timeout: config.timeoutMs });
    console.log("First setup verified bundled packages and opened datasets without skipping setup.");

    const toggle = await openAdvanced(page);
    await expect(toggle).toBeEnabled({ timeout: 30000 });
    await toggle.check();
    // Read the actual stored preference; optimistic switch state is not proof.
    await expect.poll(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_NATIVE_SIDECAR_PORT}/api/app/settings`, {
          headers: { "X-Nirs4all-Session": env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return false;
        return (await response.json()).ui_preferences?.developer_mode === true;
      } catch { return false; }
    }, { timeout: 30000 }).toBe(true);

    await page.reload();
    const reloadedToggle = await openAdvanced(page);
    await expect(reloadedToggle).toHaveAttribute("aria-checked", "true", { timeout: 30000 });
    console.log("Developer mode saved without a workspace and survived renderer reload.");

    await app.close();
    app = undefined;
    const restarted = await launch();
    const restartedToggle = await openAdvanced(restarted);
    await expect(restartedToggle).toHaveAttribute("aria-checked", "true", { timeout: config.timeoutMs });
    console.log("First-launch UI smoke passed: installed runtime, setup, Settings, saved preference, reload and app restart.");
  } catch (error) {
    console.error("Renderer errors:", errors.join("\n") || "none");
    if (app) {
      for (const page of app.windows()) {
        console.error("Current page:", page.url());
        console.error((await page.locator("body").innerText().catch(() => "")).slice(0, 8000));
      }
    }
    throw error;
  } finally {
    if (app) await app.close();
    if (!config.keepSandbox) await archive.cleanupSandboxRoot(sandbox);
  }
}

main().catch(error => { console.error("First-launch UI smoke failed:", error); process.exitCode = 1; });
