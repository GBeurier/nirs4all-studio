# Use Generators for Parameter Sweeps

Generators let you define a single pipeline that automatically expands into many variants, each testing a different step or parameter value. Instead of manually creating separate pipelines for each configuration, you define the variations once and nirs4all runs them all, ranking the results for you.

This guide covers the four types of generators available in the Pipeline Editor.

## Prerequisites

- You have a pipeline open in the Pipeline Editor (see {doc}`create-pipeline`).
- You have at least one step in your pipeline that you want to vary.

## Types of Generators

| Generator | Symbol | Purpose | Example |
|---|---|---|---|
| **Or** | `_or_` | Test multiple alternative steps | SNV vs MSC vs Detrend |
| **Range** | `_range_` | Sweep a numeric parameter linearly | PLS n_components: 1, 6, 11, 16, 21, 26 |
| **Log Range** | `_log_range_` | Sweep a numeric parameter on a log scale | Ridge alpha: 0.001, 0.01, 0.1, 1.0 |
| **Cartesian** | `_cartesian_` | Test all combinations of multiple stages | (SNV, MSC) x (PLS, Ridge) = 4 variants |

---

## Steps

### Or Generator (`_or_`) -- Test Alternatives

The `_or_` generator replaces a single step with several alternatives. Each alternative produces one pipeline variant.

1. **Add the first alternative as a regular step.** For example, add **SNV** from the Preprocessing category.

2. **Convert to a generator.** Right-click on the SNV step in the pipeline tree and select **Convert to Generator**. The step becomes an `_or_` generator node.

3. **Add more alternatives.** In the Configuration panel (right side), click **Add Alternative**. Select another step from the list, such as **MSC**. Repeat to add **Detrend** or any other alternative.

4. The pipeline tree shows the generator with its children:

   ```
   Or Generator
     ├── SNV
     ├── MSC
     └── Detrend
   ```

5. Check the **variant count badge** in the toolbar. It should show 3 variants.

:::{tip}
You can configure each alternative independently. Click on an alternative (e.g., MSC) inside the generator to access its parameters in the right panel.
:::

### Range Sweep (`_range_`) -- Linear Parameter Sweep

The `_range_` generator creates multiple copies of a step, each with a different value for one parameter.

1. **Add the step you want to sweep.** For example, add **PLSRegression**.

2. **Open the sweep configuration.** Click on the PLSRegression step. In the Configuration panel, find the parameter you want to sweep (e.g., `n_components`). Click the **sweep icon** (the small slider or wave icon) next to the parameter field.

3. **Set the sweep type to Range** and configure:
   - **From**: the starting value (e.g., `1`).
   - **To**: the ending value (e.g., `30`).
   - **Step**: the increment between values (e.g., `5`).

   This produces the values: 1, 6, 11, 16, 21, 26 -- six variants.

4. **Confirm.** A sweep badge appears on the step. The variant count updates in the toolbar.

:::{note}
The **To** value is inclusive if it falls exactly on a step boundary. For example, From=1, To=30, Step=5 produces 1, 6, 11, 16, 21, 26 (30 is not included because 26+5=31 > 30).
:::

### Log Range Sweep (`_log_range_`) -- Logarithmic Parameter Sweep

The `_log_range_` generator works like `_range_` but distributes values on a logarithmic scale. This is ideal for regularization parameters that span several orders of magnitude.

1. **Add the step.** For example, add **Ridge**.

2. **Open the sweep configuration** for the `alpha` parameter. Click the sweep icon next to the field.

3. **Set the sweep type to Log Range** and configure:
   - **From**: `0.001`
   - **To**: `1.0`
   - **Count**: `4` (number of values to generate)

   This produces approximately: 0.001, 0.01, 0.1, 1.0 -- four values evenly spaced on a log scale.

4. **Confirm.** A sweep badge appears and the variant count updates.

:::{tip}
Use `_log_range_` for parameters where doubling or halving the value matters more than adding a fixed amount. Common candidates: regularization strengths (`alpha`, `C`), learning rates, and tolerance values.
:::

### Cartesian Generator (`_cartesian_`) -- All Combinations

The `_cartesian_` generator tests all combinations of steps across two or more stages. It is the most powerful generator but also produces the most variants.

1. **Add a Cartesian node.** In the Step Palette, under the **Flow Control** category, find **Cartesian** and add it to the pipeline tree.

2. **Configure Stage 1.** In the Configuration panel, add the alternatives for the first stage. For example: **SNV** and **MSC**.

3. **Configure Stage 2.** Add the alternatives for the second stage. For example: **PLSRegression** and **Ridge**.

4. The generator produces all combinations:

   | Stage 1 | Stage 2 | Variant |
   |---|---|---|
   | SNV | PLSRegression | 1 |
   | SNV | Ridge | 2 |
   | MSC | PLSRegression | 3 |
   | MSC | Ridge | 4 |

   Total: 2 x 2 = 4 variants.

5. You can add more stages. Each additional stage multiplies the total. For example, adding a third stage with 3 alternatives: 2 x 2 x 3 = 12 variants.

:::{warning}
The variant count grows rapidly with Cartesian generators. Be mindful of the total:
- 3 x 5 = 15 variants
- 3 x 5 x 4 = 60 variants
- 4 x 6 x 5 = 120 variants

Each variant is a full training run. Large variant counts increase experiment time significantly.
:::

---

## Combining Generators

Generators can be combined within the same pipeline. When multiple generators appear in sequence, the total variant count is the product of all generator sizes.

**Example:**

```
Or Generator (SNV, MSC, Detrend)        --> 3 options
KFold (n_splits=5)
PLSRegression (n_components: range 1-30 step 5)  --> 6 options
```

Total: 3 x 6 = **18 variants**.

The **variant count badge** in the Pipeline Editor toolbar always shows the current total. Click it to see a breakdown of how each generator contributes.

---

## Viewing the Variant Count

1. Look at the **variant count badge** in the Pipeline Editor toolbar (e.g., "18 variants").

2. **Click the badge** to open a breakdown popover that shows:
   - Total variant count.
   - Each generator and how many alternatives it contributes.
   - The multiplication formula.

3. If the variant count becomes very large, consider reducing the number of alternatives or the sweep range to keep experiment time manageable.

---

## Practical Examples

| Goal | Generator setup | Variants |
|---|---|---|
| Compare 3 preprocessing methods | `_or_`: SNV, MSC, Detrend | 3 |
| Find optimal PLS components | `_range_`: n_components 1 to 20 step 2 | 10 |
| Find optimal Ridge alpha | `_log_range_`: alpha 0.001 to 100, count 6 | 6 |
| Compare preprocessing + model combos | `_cartesian_`: (SNV, MSC) x (PLS, RF, SVR) | 6 |
| Full optimization | `_or_` preprocessing (3) + `_range_` PLS components (6) | 18 |

## What's Next

- {doc}`use-branching` -- combine generators with branching for even more powerful pipeline designs.
- {doc}`add-model` -- learn about the available model types to include in your generators.
- {doc}`import-export` -- export your generator pipeline as JSON to share it.
