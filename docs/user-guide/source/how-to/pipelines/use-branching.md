# Use Branching in Pipelines

Branching lets you run multiple independent sub-pipelines in parallel within a single pipeline definition. Each branch is an isolated processing path that receives the same input data, processes it differently, and produces its own output. A merge step at the end combines or compares the branch outputs.

Branching is useful when you want to compare fundamentally different approaches -- for example, testing a PLS model against a Random Forest, or applying different preprocessing to different spectral regions.

## Prerequisites

- You have a pipeline open in the Pipeline Editor (see {doc}`create-pipeline`).
- You are familiar with basic pipeline building (adding steps, configuring parameters).

## Steps

### Add a branch node

1. In the **Step Palette** (left panel), expand the **Flow Control** category.

2. Find the **Branch** node and drag it into the pipeline tree at the position where you want the pipeline to split. You can also click the **+** button and select Branch from the menu.

3. The branch node appears in the pipeline tree with **two empty branches** (Branch 1 and Branch 2). Each branch is a vertical sub-tree where you can add any steps.

   ```{figure} /_images/how-to/pipelines/branch-node.png
   :alt: Branch node in the pipeline tree with two empty branches
   :width: 90%
   :class: screenshot

   A branch node creates two parallel paths in the pipeline.
   ```

### Add steps to each branch

4. **Click on Branch 1** in the tree to select it. The **+** button appears inside the branch.

5. Add steps to Branch 1. For example: **SNV** --> **PLSRegression** (n_components=10).

6. **Click on Branch 2** and add a different set of steps. For example: **MSC** --> **RandomForestRegressor** (n_estimators=100).

7. Your pipeline tree should now look like this:

   ```
   [Shared preprocessing, if any]
   Branch
     ├── Branch 1: SNV --> PLSRegression
     └── Branch 2: MSC --> RandomForestRegressor
   Merge
   ```

:::{tip}
To add more branches, right-click the branch node and select **Add Branch**. You can have as many parallel branches as you need.
:::

### Add a merge step

8. After the branch node, a **Merge** step is required to combine the branch outputs. If one was not added automatically, drag a **Merge** node from the Flow Control category and place it below the branch node.

9. **Click the Merge step** to configure its strategy. The merge strategy determines how the outputs from all branches are combined:

   | Strategy | Description | When to use |
   |---|---|---|
   | **predictions** | Compares predictions from each branch and reports the best-performing one | When branches represent competing approaches and you want the winner |
   | **concat** | Concatenates the outputs from all branches vertically (stacks samples) | When branches process different subsets of the data |
   | **features** | Concatenates the feature outputs from all branches horizontally | When branches extract different feature representations that should be combined into one feature matrix for a downstream model |

   ```{figure} /_images/how-to/pipelines/merge-config.png
   :alt: Merge step configuration showing strategy options
   :width: 90%
   :class: screenshot

   The merge strategy controls how branch outputs are combined.
   ```

:::{important}
The most common merge strategy is **predictions**. It trains and evaluates each branch independently and then ranks them by score. The results page will show which branch (and which specific chain within each branch) performed best.
:::

### Example: Comparing two modeling approaches

Here is a complete pipeline that compares a linear approach (SNV + PLS) against a nonlinear approach (SG derivative + Random Forest):

```
KFold (n_splits=5)
Branch
  ├── Branch 1
  │     SNV
  │     PLSRegression (n_components=10)
  └── Branch 2
        SavitzkyGolay (deriv=1, window_length=11)
        RandomForestRegressor (n_estimators=100)
Merge (strategy: predictions)
```

When this pipeline runs, nirs4all will:
1. Apply 5-fold cross-validation.
2. For each fold, run both branches independently.
3. Compare their scores and report the results for both approaches.

### Example: Branching by metadata

You can also branch based on metadata columns in your dataset (e.g., instrument, site, or batch):

1. Add a Branch node.
2. In the branch configuration, select **by_metadata** and choose the metadata column (e.g., `instrument`).
3. The pipeline automatically creates one branch per unique value in that column (e.g., one branch for `Instrument_A` and another for `Instrument_B`).
4. Add preprocessing and model steps inside each branch.

This is useful for building instrument-specific models or site-specific calibrations.

:::{note}
You can also use `by_tag` to branch based on sample tags (e.g., outlier labels) or `by_source` to branch based on the data source when working with multi-source datasets.
:::

## Combining Branching with Generators

Branches and generators can be nested. For example, you can put an `_or_` generator inside a branch to test multiple preprocessing options within one approach:

```
Branch
  ├── Branch 1
  │     Or Generator
  │       ├── SNV
  │       └── MSC
  │     PLSRegression
  └── Branch 2
        SavitzkyGolay (deriv=1)
        RandomForestRegressor
Merge (strategy: predictions)
```

This creates multiple variants: Branch 1 generates two variants (SNV+PLS and MSC+PLS), and Branch 2 generates one variant (SG+RF), for a total of 3 variants.

## What's Next

- {doc}`use-generators` -- use generators to test parameter variations within branches.
- {doc}`add-model` -- learn about available model types for your branches.
- {doc}`create-pipeline` -- review the basics of pipeline building.
