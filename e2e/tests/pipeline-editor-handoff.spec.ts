import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Real editor, router, catalog and wizard; only the disposable fixture is
// created through the API. No component, selection hook or response is mocked.
const apiBase = process.env.PLAYWRIGHT_API_BASE_URL || "http://127.0.0.1:8000";

for (const restoreDraft of [false, true]) {
  test(`editor save, edit${restoreDraft ? ", leave and reopen" : ""}, Run keeps the current pipeline selected`, async ({ page, request }, testInfo) => {
    const unique = randomUUID();
    const originalName = `Handoff original ${unique}`;
    const savedName = `Handoff saved ${unique}`;
    const editedName = `Handoff edited ${unique}`;
    const createdResponse = await request.post(`${apiBase}/api/pipelines`, {
      data: {
        name: originalName,
        description: "Disposable editor-to-experiment regression fixture",
        steps: [
          { id: "scale", type: "preprocessing", name: "StandardScaler", classPath: "sklearn.preprocessing.StandardScaler", params: {} },
          { id: "ridge", type: "model", name: "Ridge", classPath: "sklearn.linear_model.Ridge", params: { alpha: 1 } },
        ],
      },
    });
    expect(createdResponse.ok()).toBeTruthy();
    const { pipeline } = await createdResponse.json();

    try {
      await page.addInitScript(() => localStorage.setItem("nirs4all-telemetry-consent", "declined"));
      // An optional isolated backend keeps the test away from a developer's
      // default workspace. Forward to its real HTTP handlers unchanged.
      if (process.env.PLAYWRIGHT_API_BASE_URL && !process.env.RECOVERY_E2E_ROOT) {
        await page.route(url => url.pathname.startsWith("/api/"), async route => {
          const url = new URL(route.request().url());
          await route.fulfill({ response: await route.fetch({ url: `${apiBase}${url.pathname}${url.search}` }) });
        });
      }

      await page.goto(`/pipelines/${pipeline.id}`);
      const name = page.locator("header input");
      await expect(name).toHaveValue(originalName);
      await name.fill(savedName);
      const saveResponse = page.waitForResponse(response => response.url().endsWith(`/api/pipelines/${pipeline.id}`) && response.request().method() === "PUT");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      expect((await saveResponse).ok()).toBeTruthy();
      await name.fill(editedName);

      if (restoreDraft) {
        // Navigate normally away and back: React must rehydrate the editor's
        // persisted modifications, including whether they remain unsaved.
        await page.getByRole("link", { name: "Pipelines", exact: true }).click();
        await expect(page).toHaveURL(/\/pipelines$/);
        await page.goBack();
        await expect(name).toHaveValue(editedName);
      }

      await page.getByRole("button", { name: "Use in Experiment", exact: true }).click();
      await expect(page.getByRole("heading", { name: "New Experiment", exact: true })).toBeVisible();
      const selectedDraft = page.locator('[data-experiment-pipeline-id="__current_edited__"]');
      await expect(selectedDraft).toContainText(`[Current] ${editedName} (unsaved)`);
      await expect(selectedDraft.getByRole("checkbox")).toBeChecked();
      await expect(page.locator(`[data-experiment-pipeline-id="${pipeline.id}"]`).getByRole("checkbox")).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
      const storedResponse = await request.get(`${apiBase}/api/pipelines/${pipeline.id}`);
      expect((await storedResponse.json()).pipeline.name).toBe(savedName);
      await testInfo.attach("selected-edited-pipeline", { body: await page.screenshot(), contentType: "image/png" });
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Select Datasets", exact: true })).toBeVisible();
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.delete(`${apiBase}/api/pipelines/${pipeline.id}`);
    }
  });
}
