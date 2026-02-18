# Add a Cross-Validation Splitter

A splitter divides your dataset into training and test subsets so that you can evaluate model performance on data the model has not seen during training. This is essential for honest performance estimation and for avoiding overfitting. This guide describes the available splitters and how to configure them.

## Prerequisites

- You have a pipeline open in the Pipeline Editor (see {doc}`create-pipeline`).

## Why Splitting Matters

If you train and evaluate a model on the same data, the scores will be optimistically biased -- the model "memorizes" the training samples and appears to perform better than it actually does on new data. Splitting separates your data into:

- **Training set** -- the data the model learns from.
- **Test set** (or validation set) -- the data used to evaluate the model.

Cross-validation repeats this process multiple times with different splits, giving a more reliable estimate of model performance.

## Where a Splitter Goes

A splitter step should be placed **after** preprocessing steps and **before** the model step:

```
Preprocessing (SNV, SG, etc.)
  --> Splitter (KFold, KennardStone, etc.)
    --> Model (PLSRegression, RandomForest, etc.)
```

## Steps

1. **Open the Step Palette.** In the Pipeline Editor, look at the left panel.

2. **Expand the Splitting category.** Click the **Splitting** header to expand it. You will see the available splitter types.

3. **Add a splitter to the pipeline.** Drag it into the pipeline tree between your preprocessing and model steps, or click the **+** button at the desired position and select the splitter from the menu.

4. **Configure the splitter.** Click on the splitter step in the pipeline tree. The right panel displays its parameters.

   ```{figure} /_images/how-to/pipelines/splitter-config.png
   :alt: Splitter configuration panel showing KFold parameters
   :width: 90%
   :class: screenshot

   The configuration panel for a splitter shows parameters like n_splits and test_size.
   ```

## Available Splitters

### KFold

Divides the dataset into `k` equal-sized folds. Each fold takes a turn as the test set while the remaining `k-1` folds are used for training. The final score is the average across all folds.

**Key parameters:**

| Parameter | Default | Description |
|---|---|---|
| `n_splits` | 5 | Number of folds. Higher values give more reliable estimates but take longer. |
| `shuffle` | True | Whether to shuffle samples before splitting. |

**When to use:** as a general-purpose splitter for any dataset. 5 or 10 folds is standard.

:::{tip}
A 5-fold cross-validation means the model is trained 5 times, each time on 80% of the data and tested on the remaining 20%. The reported score is the average across all 5 runs.
:::

### KennardStone

Selects a calibration (training) set by iteratively choosing samples that are maximally spread in the spectral space. The remaining samples form the test set. This produces a single train/test split (not multiple folds).

**Key parameters:**

| Parameter | Default | Description |
|---|---|---|
| `test_size` | 0.2 | Fraction of samples to reserve for testing (e.g., 0.2 = 20%). |

**When to use:** the most popular splitting method for NIRS data. It ensures the training set covers the full spectral variability, which is better than random splitting for chemometric applications.

### SPXY

An extension of Kennard-Stone that considers both the spectral (X) and target (Y) variability when selecting the calibration set. This ensures the training set covers the full range of both spectra and target values.

**Key parameters:**

| Parameter | Default | Description |
|---|---|---|
| `test_size` | 0.2 | Fraction of samples for testing. |

**When to use:** when the target variable has important range coverage requirements. Particularly useful if some target values are rare.

### StratifiedKFold

A variant of KFold for classification tasks. It ensures that each fold contains approximately the same proportion of each class as the full dataset.

**Key parameters:**

| Parameter | Default | Description |
|---|---|---|
| `n_splits` | 5 | Number of folds. |

**When to use:** for classification tasks, especially when class sizes are imbalanced.

### TrainTestSplit

A simple one-time random split into training and test sets.

**Key parameters:**

| Parameter | Default | Description |
|---|---|---|
| `test_size` | 0.2 | Fraction of samples for testing. |
| `shuffle` | True | Whether to shuffle before splitting. |

**When to use:** for quick initial tests or when your dataset is very large and cross-validation is too slow.

## Choosing the Right Splitter

| Scenario | Recommended splitter | Why |
|---|---|---|
| Standard NIRS regression | KennardStone | Ensures representative calibration set |
| Regression with important target coverage | SPXY | Covers both spectral and target space |
| Classification | StratifiedKFold | Maintains class proportions across folds |
| General-purpose evaluation | KFold (5 or 10 splits) | Reliable average score |
| Quick test on large dataset | TrainTestSplit | Single split, fast |

:::{note}
You can use only one splitter per pipeline (or per branch). If you want to compare different splitting strategies, use a generator (`_or_`) to test multiple splitters in one experiment (see {doc}`use-generators`).
:::

## Understanding test_size and n_splits

- **test_size** (KennardStone, SPXY, TrainTestSplit): the fraction of your data reserved for evaluation. A value of `0.2` means 20% of samples are used for testing and 80% for training. Larger test sets give more reliable evaluation but leave less data for training.

- **n_splits** (KFold, StratifiedKFold): the number of cross-validation folds. With `n_splits=5`, each fold uses 20% for testing. With `n_splits=10`, each fold uses 10%. More splits mean more training iterations and more reliable average scores.

:::{warning}
Very small datasets (under 50 samples) require careful splitting. Using too many folds (e.g., 10-fold on 30 samples) means each fold has very few test samples, making the score estimate unreliable. For small datasets, 3-fold or 5-fold is sufficient, or use KennardStone with `test_size=0.25`.
:::

## What's Next

- {doc}`add-model` -- add a model step to complete your pipeline.
- {doc}`add-preprocessing` -- add preprocessing before the splitter.
- {doc}`use-generators` -- compare different splitters or test_size values automatically.
