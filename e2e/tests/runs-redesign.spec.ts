import { test, expect } from "../fixtures/app.fixture";
import type { Page } from "@playwright/test";

const WORKSPACE_ID = "ws-test";
const RUN_ID = "run-main";
const DATASET_NAME = "Ferment";

async function mockRunsApis(page: Page) {
  await page.route("**/api/workspaces", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspaces: [
          {
            id: WORKSPACE_ID,
            path: "D:/mock/workspace",
            name: "Mock Workspace",
            is_active: true,
            linked_at: "2026-02-25T12:00:00Z",
            last_scanned: "2026-02-26T12:00:00Z",
            discovered: { runs_count: 1, datasets_count: 1, exports_count: 0, templates_count: 0 },
          },
        ],
        active_workspace_id: WORKSPACE_ID,
        total: 1,
      }),
    });
  });

  await page.route("**/api/runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ runs: [], total: 0 }),
    });
  });

  await page.route(`**/api/workspaces/${WORKSPACE_ID}/runs/enriched**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            run_id: RUN_ID,
            name: "Sweep 50 models",
            status: "completed",
            project_id: null,
            created_at: "2026-02-25T12:00:00Z",
            completed_at: "2026-02-25T12:20:00Z",
            duration_seconds: 1200,
            artifact_size_bytes: 2048576,
            datasets_count: 3,
            pipeline_runs_count: 50,
            final_models_count: 1,
            total_models_trained: 50,
            total_folds: 5,
            datasets: [
              {
                dataset_name: DATASET_NAME,
                best_avg_val_score: 0.331,
                best_avg_test_score: 0.349,
                best_final_score: 0.298,
                metric: "rmse",
                task_type: "regression",
                gain_from_previous_best: 0.012,
                pipeline_count: 50,
                n_samples: 240,
                n_features: 620,
                top_5: [
                  {
                    chain_id: "chain-best",
                    model_name: "PLSRegression",
                    model_class: "PLSRegression",
                    preprocessings: "SNV > SG(11,2)",
                    avg_val_score: 0.331,
                    avg_test_score: 0.349,
                    avg_train_score: 0.302,
                    fold_count: 5,
                    scores: {
                      val: { rmse: 0.331, r2: 0.89 },
                      test: { rmse: 0.349, r2: 0.87 },
                    },
                    final_test_score: 0.298,
                    final_train_score: 0.274,
                    final_scores: { rmse: 0.298, r2: 0.91, mae: 0.214 },
                    best_params: { n_components: 8, scale: true, alpha: 0.001 },
                  },
                  {
                    chain_id: "chain-alt",
                    model_name: "KernelPLS",
                    model_class: "KernelPLS",
                    preprocessings: "MSC > SG(9,2)",
                    avg_val_score: 0.344,
                    avg_test_score: 0.361,
                    avg_train_score: 0.315,
                    fold_count: 5,
                    scores: {
                      val: { rmse: 0.344, r2: 0.88 },
                      test: { rmse: 0.361, r2: 0.86 },
                    },
                    final_test_score: null,
                    final_train_score: null,
                    final_scores: {},
                    best_params: { kernel: "rbf", gamma: 0.05 },
                  },
                ],
              },
              {
                dataset_name: "Ferment_X_Val",
                best_avg_val_score: 0.8,
                best_avg_test_score: 0.8,
                best_final_score: null,
                metric: "rmse",
                task_type: "regression",
                gain_from_previous_best: null,
                pipeline_count: 1,
                n_samples: 10,
                n_features: 10,
                top_5: [],
              },
              {
                dataset_name: "Ferment_X_cal",
                best_avg_val_score: 0.8,
                best_avg_test_score: 0.8,
                best_final_score: null,
                metric: "rmse",
                task_type: "regression",
                gain_from_previous_best: null,
                pipeline_count: 1,
                n_samples: 10,
                n_features: 10,
                top_5: [],
              },
            ],
          },
        ],
        total: 1,
      }),
    });
  });

  await page.route(`**/api/workspaces/${WORKSPACE_ID}/runs/${RUN_ID}/datasets/${DATASET_NAME}/chains`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        metric: "rmse",
        total: 3,
        chains: [
          {
            chain_id: "chain-mid",
            model_name: "iPLS",
            model_class: "iPLS",
            preprocessings: "SNV > SG(11,2)",
            best_params: { interval: 4 },
            cv_val_score: 0.45,
            cv_test_score: 0.47,
            cv_train_score: 0.39,
            cv_fold_count: 5,
            cv_scores: { val: { rmse: 0.45 }, test: { rmse: 0.47 }, train: { rmse: 0.39 } },
            final_test_score: null,
            final_train_score: null,
            final_scores: {},
            metric: "rmse",
            task_type: "regression",
          },
          {
            chain_id: "chain-best",
            model_name: "PLSRegression",
            model_class: "PLSRegression",
            preprocessings: "SNV > SG(11,2)",
            best_params: { n_components: 8, scale: true },
            cv_val_score: 0.33,
            cv_test_score: 0.35,
            cv_train_score: 0.30,
            cv_fold_count: 5,
            cv_scores: { val: { rmse: 0.33 }, test: { rmse: 0.35 }, train: { rmse: 0.30 } },
            final_test_score: 0.298,
            final_train_score: 0.274,
            final_scores: { rmse: 0.298, r2: 0.91 },
            metric: "rmse",
            task_type: "regression",
          },
          {
            chain_id: "chain-worst",
            model_name: "RandomForestRegressor",
            model_class: "RandomForestRegressor",
            preprocessings: "Raw",
            best_params: { n_estimators: 500, max_depth: 10 },
            cv_val_score: 0.51,
            cv_test_score: 0.55,
            cv_train_score: 0.44,
            cv_fold_count: 5,
            cv_scores: { val: { rmse: 0.51 }, test: { rmse: 0.55 }, train: { rmse: 0.44 } },
            final_test_score: null,
            final_train_score: null,
            final_scores: {},
            metric: "rmse",
            task_type: "regression",
          },
        ],
      }),
    });
  });

  await page.route("**/api/aggregated-predictions/chain/*/detail**", async (route) => {
    const url = new URL(route.request().url());
    const chainId = url.pathname.split("/").slice(-2)[0];
    const predictions = [
      { prediction_id: `${chainId}-f0-train`, fold_id: "fold_0", partition: "train", val_score: 0.34, test_score: 0.35, train_score: 0.3 },
      { prediction_id: `${chainId}-f0-val`, fold_id: "fold_0", partition: "val", val_score: 0.33, test_score: 0.34, train_score: 0.31 },
      { prediction_id: `${chainId}-f0-test`, fold_id: "fold_0", partition: "test", val_score: 0.34, test_score: 0.35, train_score: 0.31 },
      { prediction_id: `${chainId}-f1-train`, fold_id: "fold_1", partition: "train", val_score: 0.35, test_score: 0.36, train_score: 0.32 },
      { prediction_id: `${chainId}-f1-val`, fold_id: "fold_1", partition: "val", val_score: 0.34, test_score: 0.35, train_score: 0.32 },
      { prediction_id: `${chainId}-f1-test`, fold_id: "fold_1", partition: "test", val_score: 0.35, test_score: 0.36, train_score: 0.33 },
    ].map((row) => ({
      ...row,
      pipeline_id: "pipeline-1",
      chain_id: chainId,
      dataset_name: DATASET_NAME,
      model_name: "PLSRegression",
      model_class: "PLSRegression",
      metric: "rmse",
      task_type: "regression",
      n_samples: 120,
      n_features: 620,
      preprocessings: "SNV > SG(11,2)",
    }));

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chain_id: chainId,
        predictions,
        total: predictions.length,
        partition: null,
        fold_id: null,
      }),
    });
  });

  await page.route("**/api/aggregated-predictions/chain/*", async (route) => {
    const url = new URL(route.request().url());
    const chainId = url.pathname.split("/").pop();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chain_id: chainId,
        summary: {
          chain_id: chainId,
          pipeline_id: "pipeline-1",
          model_name: "PLSRegression",
          model_class: "PLSRegression",
          preprocessings: "SNV > SG(11,2)",
          metric: "rmse",
          task_type: "regression",
          dataset_name: DATASET_NAME,
          cv_val_score: 0.33,
          cv_test_score: 0.35,
          cv_train_score: 0.3,
          cv_fold_count: 5,
          final_test_score: 0.298,
          final_train_score: 0.274,
          final_scores: { rmse: 0.298, r2: 0.91 },
          cv_scores: { val: { rmse: 0.33 }, test: { rmse: 0.35 }, train: { rmse: 0.3 } },
          best_params: { n_components: 8, scale: true },
          pipeline_status: "completed",
          run_id: RUN_ID,
          branch_path: null,
          source_index: null,
          model_step_idx: 0,
        },
        predictions: [],
        pipeline: {
          pipeline_id: "pipeline-1",
          name: "Mock Pipeline",
          dataset_name: DATASET_NAME,
          generator_choices: null,
          status: "completed",
          metric: "rmse",
          best_val: 0.33,
          best_test: 0.35,
        },
      }),
    });
  });

  await page.route("**/api/aggregated-predictions/*/arrays", async (route) => {
    const predictionId = route.request().url().split("/").slice(-2)[0];
    const offset = predictionId.includes("train") ? 0.0 : predictionId.includes("val") ? 0.04 : 0.08;
    const yTrue = [1.0, 1.3, 1.6, 1.9, 2.2];
    const yPred = yTrue.map((v, i) => v + offset - (i % 2 === 0 ? 0.03 : -0.02));

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        prediction_id: predictionId,
        y_true: yTrue,
        y_pred: yPred,
        y_proba: null,
        sample_indices: [0, 1, 2, 3, 4],
        weights: null,
        n_samples: yTrue.length,
      }),
    });
  });
}

test.describe("Runs Redesign", () => {
  test("shows best refit info and fold-level details without a separate all-models panel", async ({ page, runsPage }) => {
    await mockRunsApis(page);

    await runsPage.goto();
    await expect(page.getByText("Sweep 50 models")).toBeVisible();
    await page.getByText("Sweep 50 models").click();

    await expect(page.getByText("Ferment_X_Val")).toHaveCount(0);
    await expect(page.getByText("Ferment_X_cal")).toHaveCount(0);

    await expect(page.getByText(/^Best Refit$/)).toBeVisible();
    await expect(page.getByText(/^RMSEP$/).first()).toBeVisible();
    await expect(page.getByText(/Show all trained models/i)).toHaveCount(0);

    await page.getByRole("heading", { name: DATASET_NAME }).click();
    await expect(page.getByText(/CV models \(not refit\)/i)).toBeVisible();
    await page.getByRole("button", { name: /PLSRegression/i }).first().click();
    await expect(page.getByText(/RMSECV/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /PLSRegression Fold fold_0/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /PLSRegression Fold fold_1/i })).toBeVisible();
    await expect(page.getByText(/^Val$/).first()).toBeVisible();

    await page.getByRole("button", { name: /^details$/i }).last().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByRole("button", { name: /Predicted vs Actual/i }).first().click();
    await expect(page.getByText(/Predicted vs Actual/i).first()).toBeVisible();
    await expect(page.getByText(/^val$/i).first()).toBeVisible();
    await expect(page.getByText(/^test$/i).first()).toBeVisible();
    await expect(page.getByText(/^train$/i).first()).toBeVisible();

    await page.getByRole("button", { name: /Residuals/i }).first().click();
    await expect(page.getByText(/Residuals/i).first()).toBeVisible();
  });
});
