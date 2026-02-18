(build-advanced-pipeline)=
# Building Advanced Pipelines

**Time**: ~15 minutes | **Level**: Intermediate

In {doc}`first-experiment` you built a simple linear pipeline with one preprocessing step, one splitter, and one model. That is a great starting point, but real-world NIRS analysis often requires testing many configurations to find the best one.

In this tutorial you will learn how to use **generators**, **parameter sweeps**, and **branching** in the Pipeline Editor to create a single pipeline definition that automatically expands into dozens or hundreds of variants. nirs4all runs all of them and ranks the results for you.

:::{admonition} Prerequisites
:class: note

- You are familiar with the Pipeline Editor (see {doc}`first-experiment`, steps 4-5).
- You have at least one dataset in your workspace.
:::

---

## Key concepts

Before building, let us understand the three power features of the Pipeline Editor:

| Feature | What it does | Pipeline Editor UI |
|---|---|---|
| **Generator (`_or_`)** | Tests multiple alternatives for a single step | A step with several child options |
| **Parameter Sweep (`_range_`)** | Tests a range of values for a step parameter | A sweep badge on a step |
| **Branch** | Runs parallel sub-pipelines and optionally merges results | A branching node in the tree |

When you combine these features, the total number of pipeline **variants** multiplies. For example, 3 preprocessing alternatives multiplied by 6 PLS component values equals 18 variants, all run automatically.

---

## Step 1 -- Open the Pipeline Editor

1. Click **Pipelines** in the left sidebar.
2. Click **New Pipeline**.
3. Name the pipeline `Advanced Comparison` using the name field in the toolbar.

---

## Step 2 -- Add a preprocessing generator (`_or_`)

A generator lets you specify multiple alternatives for a single step. nirs4all will try each one and report which performed best.

1. In the **Step Palette** (left panel), expand the **Preprocessing** category.
2. Click **SNV** to add it as the first step.
3. In the pipeline tree (center panel), right-click on the **SNV** step (or click the step's action menu icon).
4. Select **Convert to Generator** from the context menu.
5. The step transforms into a generator node. The generator panel appears in the Configuration (right panel).
6. Click **Add Alternative** in the generator panel.
7. From the list that appears, select **MSC**.
8. Click **Add Alternative** again and select **Detrend**.

Your pipeline tree now shows a generator step with three children:

> **Or Generator**
>   - SNV
>   - MSC
>   - Detrend

:::{admonition} What the `_or_` generator does
:class: info

When nirs4all expands this pipeline, it creates three separate variants:
1. A pipeline that uses SNV.
2. A pipeline that uses MSC.
3. A pipeline that uses Detrend.

Each variant is trained and evaluated independently. The results page will show which preprocessing gave the best score.
:::

Look at the **variant count badge** in the toolbar -- it should now display **3 variants**.

---

## Step 3 -- Add a splitter

1. In the Step Palette, expand the **Splitting** category.
2. Click **KFold** to add it after the generator.
3. In the Configuration panel, set **n_splits** to `5`.

This adds 5-fold cross-validation. Every variant will be evaluated using 5 folds.

---

## Step 4 -- Add a model with a parameter sweep (`_range_`)

Now add a PLS model and sweep across different numbers of components:

1. In the Step Palette, expand the **Models** category.
2. Click **PLSRegression** to add it.
3. Select the **PLSRegression** step in the pipeline tree.
4. In the Configuration panel (right side), find the **n_components** parameter.
5. Click the **sweep icon** next to the parameter field (it looks like a small wave or slider icon). This opens the sweep configuration.
6. Set the sweep type to **Range** and configure:
   - **From**: `1`
   - **To**: `30`
   - **Step**: `5`

   This creates values: 1, 6, 11, 16, 21, 26 -- that is 6 values.

7. Confirm the sweep. A **sweep badge** appears on the PLSRegression step.

:::{admonition} What the `_range_` sweep does
:class: info

The `_range_` sweep generates multiple copies of the PLSRegression step, each with a different value for `n_components`. Combined with the 3 preprocessing alternatives, the total is now:

> 3 preprocessing options x 6 component values = **18 variants**

The variant count badge in the toolbar updates to reflect this.
:::

---

## Step 5 -- Understand the variant count

The **variant count badge** in the Pipeline Editor toolbar shows the total number of pipeline variants that will be trained when you run this pipeline.

1. Click the variant count badge to open the **breakdown popover**.
2. The popover shows:
   - **Total variants**: 18
   - **Breakdown by step**: which step contributes how many alternatives.

:::{warning}
Be mindful of the variant count. Adding more generators and sweeps multiplies the total exponentially. For example:

- 3 preprocessing x 6 PLS components = 18 variants
- 3 preprocessing x 6 PLS components x 5 Ridge alpha values = 90 variants
- 3 preprocessing x 10 PLS components x 10 Ridge alpha values = 300 variants

Large variant counts mean longer experiment times. For initial exploration, keep it under 100. For thorough optimization, hundreds are fine if you have time.
:::

---

## Step 6 -- Add branching (optional, advanced)

Branching lets you run completely separate sub-pipelines in parallel. This is useful when you want to compare fundamentally different approaches -- for example, PLS versus Random Forest.

1. In the Step Palette, look for the **Branch** node (under the **Flow** or **Branching** category).
2. Drag or click it to add a Branch step at the position where you want the pipeline to split.
3. The branch node appears with two empty branches. Each branch is an independent sub-pipeline.
4. Add steps to **Branch 1**: for example, PLSRegression with n_components = 10.
5. Add steps to **Branch 2**: for example, Ridge regression with alpha = 1.0.
6. After the branch, add a **Merge** step. In its configuration, select the merge strategy:
   - **predictions** -- compare the predictions from each branch and keep the best.

:::{tip}
You can combine branching with generators. For example, put a generator inside one branch to test SNV vs MSC, while the other branch uses a different approach entirely.
:::

---

## Step 7 -- Review the full pipeline

Your final pipeline tree should look something like this:

```
Or Generator
  ├── SNV
  ├── MSC
  └── Detrend
KFold (n_splits=5)
PLSRegression (n_components: sweep 1-30 step 5)
```

Verify in the toolbar:
- The variant count badge shows the expected number (e.g., 18).
- No validation errors appear (a red warning icon would indicate a problem).

---

## Step 8 -- Save and run

1. Click **Save** in the toolbar.
2. Click **Use in Experiment** to launch the experiment wizard.
3. Follow the wizard steps (select dataset, confirm pipeline, review, launch) as described in {doc}`first-experiment`.

When the experiment completes, the Results page will show all 18 (or more) variants ranked by score. You can quickly identify which preprocessing and component count combination works best.

---

## Bonus -- Using the Code View

For a compact summary of your pipeline, click the **Code View** button (the `</>` icon) in the Pipeline Editor toolbar. This switches from the tree view to a YAML representation of the pipeline, showing the nirs4all syntax including `_or_` generators and `_range_` sweeps.

This view is read-only but useful for:
- Verifying that generators and sweeps are correctly configured.
- Copying the pipeline definition for use in Python scripts with the nirs4all library.

---

## What you learned

In this tutorial you:

1. Created a preprocessing generator (`_or_`) to test SNV, MSC, and Detrend automatically.
2. Added a parameter sweep (`_range_`) on PLS n_components.
3. Understood how generators and sweeps multiply the variant count.
4. Learned about branching for comparing fundamentally different approaches.
5. Reviewed the pipeline and launched a multi-variant experiment.

---

## Next steps

- {doc}`analyze-model-performance` -- After running a multi-variant experiment, use the Inspector to compare model performance across all variants.
- {doc}`batch-predictions` -- Export the best model and use it to predict new samples.
