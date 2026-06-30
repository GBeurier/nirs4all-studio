import { describe, expect, it } from "vitest";

import {
  buildModelActionCsv,
  buildModelActionCsvFilename,
  buildModelActionDeleteDescriptor,
  buildModelActionLinks,
} from "@/lib/modelActionMenuData";
import type { PartitionPrediction } from "@/types/aggregated-predictions";

function prediction(overrides: Partial<PartitionPrediction> = {}): PartitionPrediction {
  return {
    prediction_id: "pred-1",
    pipeline_id: "pipe-1",
    chain_id: "chain-1",
    dataset_name: "dataset-a",
    model_name: "PLS",
    model_class: "PLSRegression",
    fold_id: "0",
    partition: "test",
    val_score: null,
    test_score: 0.25,
    train_score: null,
    scores: { rmse: 0.25 },
    best_params: null,
    metric: "rmse",
    task_type: "regression",
    n_samples: 10,
    n_features: 128,
    preprocessings: "SNV",
    ...overrides,
  };
}

describe("model action menu data", () => {
  it("builds encoded action links", () => {
    expect(buildModelActionLinks({
      chainId: "chain 1",
      predictChainId: "predict/1",
      datasetName: "corn dataset",
      hasRefit: true,
    })).toEqual({
      datasetUrl: "/datasets/corn%20dataset",
      pipelineEditorUrl: "/pipelines/new?chainId=chain%201",
      predictUrl: "/predict?model_id=predict%2F1&source=chain",
    });

    expect(buildModelActionLinks({
      chainId: "chain-1",
      hasRefit: false,
    }).predictUrl).toBeNull();
  });

  it("builds predict links from explicit chain or bundle model refs", () => {
    expect(buildModelActionLinks({
      chainId: "chain-1",
      predictModel: { id: "bundle without path", source: "bundle" },
      hasRefit: true,
    }).predictUrl).toBe("/predict?model_id=bundle%20without%20path&source=bundle");

    expect(buildModelActionLinks({
      chainId: "chain-1",
      predictModel: { id: "chain/with/slash.n4a", source: "chain" },
      hasRefit: true,
    }).predictUrl).toBe("/predict?model_id=chain%2Fwith%2Fslash.n4a&source=chain");
  });

  it("builds delete descriptors for chain and group scopes", () => {
    expect(buildModelActionDeleteDescriptor({
      chainId: "chain-1",
      deleteScope: "chain",
      modelName: "PLS",
      workspaceId: "workspace-1",
    })).toMatchObject({
      artifactHandling: "preserve-shared",
      canDelete: true,
      description: "This removes all stored predictions for the displayed PLS variant, including matched CV/refit siblings. Shared artifacts still used by other models are preserved automatically.",
      label: "Delete model",
      title: "Delete model predictions?",
    });

    expect(buildModelActionDeleteDescriptor({
      chainId: "chain-1",
      deleteScope: "group",
      modelName: "PLS",
      workspaceId: "workspace-1",
    })).toMatchObject({
      artifactHandling: "cleanup-orphans",
      canDelete: false,
      label: "Delete prediction",
      title: "Delete prediction group?",
    });

    expect(buildModelActionDeleteDescriptor({
      chainId: "chain-1",
      deleteScope: "group",
      foldId: "fold-0",
      modelName: "PLS",
      workspaceId: "workspace-1",
    })).toMatchObject({
      artifactHandling: "cleanup-orphans",
      canDelete: true,
      description: "This removes the fold-0 prediction group for PLS, including linked arrays. Empty chains and orphaned artifacts will be cleaned automatically.",
    });
  });

  it("builds escaped CSV from partition predictions", () => {
    const csv = buildModelActionCsv([
      prediction({
        dataset_name: "dataset, with comma",
        model_name: 'PLS "A"',
        preprocessings: "SNV\nMSC",
      }),
    ]);

    expect(csv.split("\n")[0]).toBe("fold_id,partition,model_name,dataset_name,val_score,test_score,train_score,metric,n_samples,preprocessings");
    expect(csv).toContain('"PLS ""A"""');
    expect(csv).toContain('"dataset, with comma"');
    expect(csv).toContain('"SNV\nMSC"');
  });

  it("builds sanitized CSV filenames", () => {
    expect(buildModelActionCsvFilename("PLS / tuned", "abcdef123456")).toBe("PLS_tuned_abcdef12.csv");
    expect(buildModelActionCsvFilename("", "")).toBe("chain_chain.csv");
  });
});
