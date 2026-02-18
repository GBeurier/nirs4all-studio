# Add a Prediction Model

A model is the core of your pipeline -- it is the algorithm that learns the relationship between spectra and the target property. This guide describes the available model types and how to add and configure them in the Pipeline Editor.

## Prerequisites

- You have a pipeline open in the Pipeline Editor (see {doc}`create-pipeline`).
- Your pipeline already has at least a preprocessing step. Models are typically placed at the end of the pipeline.

## Where a Model Goes

A model step should be placed **after** preprocessing and splitting steps. A standard pipeline order is:

```
Preprocessing (SNV, SG, etc.)
  --> Splitter (KFold, KennardStone, etc.)
    --> Model (PLSRegression, RandomForest, etc.)
```

Every pipeline needs exactly one model step (or multiple inside a branch -- see {doc}`use-branching`).

## Steps

1. **Open the Step Palette.** In the Pipeline Editor, look at the left panel.

2. **Expand the Models category.** Click the **Models** header in the Step Palette to expand it. You will see a list of available model algorithms.

3. **Add a model to the pipeline.** Drag the model you want from the palette into the pipeline tree at the correct position (after the splitter), or click the **+** button below the splitter step and select the model from the menu.

4. **Configure the model.** Click on the model step in the pipeline tree. The right panel (Step Configuration) displays all configurable parameters. Adjust values as needed -- changes take effect immediately.

   ```{figure} /_images/how-to/pipelines/model-config.png
   :alt: Model configuration panel showing PLSRegression parameters
   :width: 90%
   :class: screenshot

   Clicking a model step reveals its parameters in the configuration panel.
   ```

## Available Models

### Regression Models

These models predict a continuous numeric value (e.g., moisture %, protein content, pH).

PLSRegression (Partial Least Squares)
: The standard workhorse for NIRS calibration. Finds latent components that maximize covariance between spectra and the target property.
: **Key parameters:**
  - `n_components` -- number of latent variables (default: 10). More components capture more detail but risk overfitting.
: **When to use:** as your default first choice for NIRS regression. Works well when the relationship is approximately linear.

:::{tip}
Not sure how many PLS components to use? Add a parameter sweep on `n_components` (e.g., 1 to 30, step 5) to let nirs4all find the optimal value automatically. See {doc}`use-generators` for details.
:::

Ridge
: Linear regression with L2 regularization. Prevents overfitting by penalizing large coefficients.
: **Key parameters:**
  - `alpha` -- regularization strength (default: 1.0). Higher values mean more regularization.
: **When to use:** when you want a simple linear model with regularization, or as a baseline comparison.

Lasso
: Linear regression with L1 regularization. Can produce sparse models (some coefficients become exactly zero), effectively selecting a subset of wavelengths.
: **Key parameters:**
  - `alpha` -- regularization strength (default: 1.0).
: **When to use:** when you suspect that only a few wavelength regions are informative.

ElasticNet
: Combines L1 and L2 regularization. A middle ground between Ridge and Lasso.
: **Key parameters:**
  - `alpha` -- overall regularization strength.
  - `l1_ratio` -- balance between L1 and L2 (0 = pure Ridge, 1 = pure Lasso).

SVR (Support Vector Regression)
: A nonlinear model that maps spectra into a high-dimensional space and finds an optimal hyperplane.
: **Key parameters:**
  - `C` -- regularization parameter (default: 1.0). Higher values fit training data more closely.
  - `epsilon` -- insensitivity margin.
  - `kernel` -- kernel function (`rbf`, `linear`, `poly`).
: **When to use:** when the relationship between spectra and target is nonlinear and PLS gives poor results.

RandomForestRegressor
: An ensemble of decision trees that averages their predictions. Robust to outliers and nonlinear relationships.
: **Key parameters:**
  - `n_estimators` -- number of trees (default: 100). More trees generally improve performance but increase computation time.
  - `max_depth` -- maximum tree depth (default: none). Limiting depth prevents overfitting.
: **When to use:** when you want a nonlinear model that is robust and requires little tuning.

### Classification Models

These models predict a categorical label (e.g., sample type, quality grade, species).

RandomForestClassifier
: An ensemble of decision trees for classification. The most commonly used classifier for spectral data.
: **Key parameters:**
  - `n_estimators` -- number of trees (default: 100).
  - `max_depth` -- maximum tree depth.
: **When to use:** as your default first choice for classification tasks.

SVC (Support Vector Classification)
: Finds an optimal separating hyperplane between classes in a high-dimensional feature space.
: **Key parameters:**
  - `C` -- regularization parameter.
  - `kernel` -- kernel function (`rbf`, `linear`, `poly`).
: **When to use:** when classes are well-separated and you want a strong linear or nonlinear classifier.

PLSDiscriminantAnalysis
: A variant of PLS adapted for classification. Projects the data into a latent space that maximizes class separation.
: **Key parameters:**
  - `n_components` -- number of latent variables.
: **When to use:** when you want a PLS-based approach for classification.

### Neural Network Models

For advanced users, nirs4all Studio supports deep learning models.

MLPRegressor / MLPClassifier
: Multi-Layer Perceptron -- a fully connected neural network.
: **Key parameters:**
  - `hidden_layer_sizes` -- architecture (e.g., `(100, 50)` for two hidden layers).
  - `activation` -- activation function (`relu`, `tanh`).
  - `learning_rate_init` -- initial learning rate.
: **When to use:** when you have a large dataset and want to explore deep learning. Requires more tuning than classical models.

:::{note}
Neural network models (TensorFlow, PyTorch, JAX backends) are available when the corresponding deep learning framework is installed in the nirs4all environment. If they are not installed, these models will appear grayed out in the Step Palette.
:::

## Choosing the Right Model

| Scenario | Recommended model | Why |
|---|---|---|
| Standard NIRS regression | PLSRegression | Fast, interpretable, excellent for linear relationships |
| Nonlinear regression | RandomForestRegressor or SVR | Can capture complex, nonlinear patterns |
| Binary classification | SVC or RandomForestClassifier | Strong classifiers with good generalization |
| Multi-class classification | RandomForestClassifier | Handles multiple classes naturally |
| Large dataset (>5000 samples) | RandomForestRegressor or MLP | Scale well with data size |
| Sparse, interpretable model | Lasso | Automatically selects informative wavelengths |

:::{important}
Start simple. PLSRegression (for regression) or RandomForestClassifier (for classification) should be your first attempt. Only switch to more complex models if the simple ones do not achieve satisfactory scores.
:::

## What's Next

- {doc}`add-splitter` -- add cross-validation to evaluate your model properly.
- {doc}`add-preprocessing` -- ensure your spectra are preprocessed before the model.
- {doc}`use-generators` -- test multiple models or parameter values automatically.
