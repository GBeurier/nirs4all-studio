# Export a Trained Model

This guide walks you through exporting a trained model from nirs4all Studio as a `.n4a` bundle file. A model bundle packages everything needed to make predictions on new data, making it easy to share with colleagues or deploy in production.

## Prerequisites

- At least one experiment has completed successfully (see {doc}`../experiments/launch-experiment`).
- You have identified the chain you want to export (see {doc}`view-scores`).

---

## Steps

1. **Open the Results page.** Click **Results** in the left sidebar. The Scores tab appears.

2. **Locate the chain to export.** Browse the score cards to find the chain with the best performance for your use case. You can sort by R2, RMSE, or accuracy to bring the best chain to the top.

3. **Open the chain actions menu.** Click on the chain card to expand it. Look for the **Export Model** button (download icon) in the actions area.

4. **Click Export Model.** A dialog opens with export options:

   - **File name** -- defaults to the chain name. Edit it to give the file a meaningful name.
   - **Include metadata** -- checked by default. Metadata includes the dataset name, experiment date, and performance scores.

5. **Save the bundle.** Click **Export** and choose a location on your computer. The file is saved with the `.n4a` extension.

:::{tip}
Use a descriptive file name that includes the model type and dataset, such as `corn-moisture-snv-pls10.n4a`. This makes it easier to identify bundles later.
:::

---

## What Is Inside a .n4a Bundle?

A `.n4a` bundle is a self-contained archive that includes everything required to reproduce the model's predictions:

| Component              | Description                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| **Trained model**      | The fitted model weights (e.g., PLS coefficients, random forest trees). |
| **Preprocessing chain**| The exact sequence of preprocessing steps with their fitted parameters (e.g., SNV reference spectrum, scaler mean/std). |
| **Pipeline metadata**  | The step names, order, and hyperparameter values used during training. |
| **Dataset metadata**   | Feature names (wavelengths), target name, signal type, and units.  |
| **Performance scores** | The cross-validation scores achieved during training.              |
| **Bundle manifest**    | Version information and compatibility data.                        |

:::{important}
The bundle contains fitted transformers, not raw data. Your original spectra and reference values are **not** included in the export. The bundle only stores what is needed to transform new spectra and predict new values.
:::

---

## Using the Exported Model

Once exported, a `.n4a` bundle can be used in several ways:

- **In nirs4all Studio** -- import the bundle on the Predictions page to make predictions on new datasets without retraining.
- **In Python** -- load the bundle with the nirs4all library:

  ```python
  import nirs4all

  predictions = nirs4all.predict("corn-moisture-snv-pls10.n4a", new_data)
  ```

- **Share with colleagues** -- send the `.n4a` file to anyone who has nirs4all Studio or the nirs4all Python library installed.

:::{note}
Bundles are forward-compatible: a bundle created with an older version of nirs4all can be loaded by newer versions. The manifest inside the bundle records the version it was created with.
:::

---

## What's Next

- {doc}`view-scores` -- review scores to decide which model to export.
- {doc}`export-predictions` -- export the prediction values rather than the model itself.
- {doc}`compare-chains` -- compare chains before choosing which to export.
