# Node Catalog

This page lists every pipeline node available in the {doc}`pipeline-editor-page`, organized by category. Each entry shows the node name, a brief description, and its key configurable parameters.

---

## Preprocessing -- NIRS Core

| Node | Description | Key parameters |
|------|-------------|----------------|
| **SNV** | Standard Normal Variate normalization. Normalizes each spectrum to zero mean and unit variance for scatter correction. | *(none)* |
| **RobustSNV** | Outlier-resistant SNV using median and MAD instead of mean/std. | *(none)* |
| **LocalSNV** | Local SNV applied in a sliding window for local scatter correction. | *(none)* |
| **MSC** | Multiplicative Scatter Correction. Regresses each spectrum against a reference (mean or median). | `reference`: mean or median |
| **EMSC** | Extended MSC with polynomial baseline correction and optional interference components. | `reference`: mean or median |

## Preprocessing -- Baseline

| Node | Description | Key parameters |
|------|-------------|----------------|
| **Detrend** | Removes polynomial trends using least squares fitting. | `order`: polynomial order (default 2) |
| **BaselineCorrection** | Fits and subtracts a polynomial baseline. | `order`: polynomial order (default 2) |
| **ASLSBaseline** | Asymmetric Least Squares Smoothing baseline estimation. | `lam`: smoothness, `p`: asymmetry |
| **AirPLS** | Adaptive Iteratively Reweighted PLS baseline correction. | `lam`: smoothness |
| **ArPLS** | Asymmetrically Reweighted PLS baseline correction. | `lam`: smoothness |
| **SNIP** | Statistics-sensitive Non-linear Iterative Peak-clipping. | `max_half_window`: window size (default 40) |
| **RollingBall** | Rolling ball algorithm for baseline estimation. | `half_window`: half-window size (default 25) |
| **ModPoly** | Modified Polynomial fitting for baseline estimation. | `poly_order`: polynomial order (default 2) |
| **IModPoly** | Improved Modified Polynomial fitting. | `poly_order`: polynomial order (default 2) |

## Preprocessing -- Derivatives

| Node | Description | Key parameters |
|------|-------------|----------------|
| **SavitzkyGolay** | Savitzky-Golay filter for smoothing and/or derivatives. | `window_length` (default 11), `polyorder` (default 2), `deriv`: 0/1/2 |
| **FirstDerivative** | Computes the first spectral derivative. Removes constant baseline offsets. | *(none)* |
| **SecondDerivative** | Computes the second spectral derivative. Resolves overlapping peaks. | *(none)* |

## Preprocessing -- Scaling

| Node | Description | Key parameters |
|------|-------------|----------------|
| **StandardScaler** | Standardizes to zero mean and unit variance. | *(none)* |
| **MinMaxScaler** | Scales features to a given range. | `feature_range_min` (default 0), `feature_range_max` (default 1) |
| **RobustScaler** | Robust scaling using median and IQR. | *(none)* |
| **MaxAbsScaler** | Scales by maximum absolute value to [-1, 1]. | *(none)* |

---

## Filters

| Node | Description | Key parameters |
|------|-------------|----------------|
| **YOutlierFilter** | Identifies target (y) value outliers. | `method`: iqr/zscore/percentile/mad, `threshold` (default 1.5) |
| **XOutlierFilter** | Identifies spectral (X) outliers. | `method`: mahalanobis/robust_mahalanobis/pca_residual/pca_leverage/isolation_forest/lof, `threshold` |
| **SpectralQualityFilter** | Flags samples with NaN, zero, low variance, or out-of-range values. | `max_nan_ratio`, `max_zero_ratio`, `min_variance`, `check_inf` |
| **HighLeverageFilter** | Identifies high-leverage samples via hat matrix or PCA. | `method`: hat/pca, `threshold_multiplier` (default 2) |
| **MetadataFilter** | Filters samples based on metadata column values. | `column`, `values_to_exclude`, `values_to_keep` |

---

## Splitting -- NIRS Splitters

| Node | Description | Key parameters |
|------|-------------|----------------|
| **KennardStone** | Distance-based representative sampling for uniform coverage of the design space. | `test_size` (default 0.2), `metric`: euclidean/mahalanobis/cosine |
| **SPXY** | Sample Partitioning based on both X and Y spaces. | `test_size` (default 0.2) |
| **SPXYGFold** | SPXY-based K-fold cross-validation. | `n_splits` (default 5) |
| **KMeansSplitter** | K-means clustering based train/test split. | `n_clusters` (default 5), `test_size` (default 0.2) |
| **KBinsStratifiedSplitter** | Bins-based stratification for regression problems. | `n_bins` (default 5), `test_size` (default 0.2) |
| **BinnedStratifiedGroupKFold** | Group-aware binned stratified K-fold. | `n_splits` (default 5), `n_bins` (default 5) |
| **SystematicCircularSplitter** | Systematic sampling with circular wrapping. | `test_size` (default 0.2) |

## Splitting -- sklearn Splitters

| Node | Description | Key parameters |
|------|-------------|----------------|
| **KFold** | Standard K-fold cross-validation. | `n_splits` (default 5), `shuffle` (default true) |
| **RepeatedKFold** | Repeated K-fold with different randomization each time. | `n_splits` (default 5), `n_repeats` (default 3) |
| **StratifiedKFold** | Stratified K-fold for classification problems. | `n_splits` (default 5), `shuffle` (default true) |
| **ShuffleSplit** | Random repeated train/test splits. | `n_splits` (default 10), `test_size` (default 0.2) |
| **LeaveOneOut** | Each sample used once as the test set. | *(none)* |
| **GroupKFold** | K-fold ensuring same-group samples stay together. | `n_splits` (default 5) |
| **GroupShuffleSplit** | Group-aware random train/test splits. | `n_splits` (default 5), `test_size` (default 0.2) |

---

## Models -- PLS

| Node | Description | Key parameters |
|------|-------------|----------------|
| **PLSRegression** | Partial Least Squares Regression. The gold standard for NIRS calibration. | `n_components` (default 10), `max_iter` (default 500) |
| **PLSDA** | PLS Discriminant Analysis for classification using dummy encoding. | `n_components` (default 10) |

## Models -- Linear

| Node | Description | Key parameters |
|------|-------------|----------------|
| **Ridge** | Ridge regression with L2 regularization. | `alpha` (default 1) |
| **Lasso** | Lasso regression with L1 regularization (feature selection). | `alpha` (default 1) |
| **ElasticNet** | Combined L1+L2 regularization. | `alpha` (default 1), `l1_ratio` (default 0.5) |

## Models -- SVM

| Node | Description | Key parameters |
|------|-------------|----------------|
| **SVR** | Support Vector Regression with kernel methods. | `kernel`: rbf/linear/poly/sigmoid, `C` (default 1), `epsilon` (default 0.1) |
| **SVC** | Support Vector Classification with kernel methods. | `kernel`: rbf/linear/poly/sigmoid, `C` (default 1) |

## Models -- Ensemble

| Node | Description | Key parameters |
|------|-------------|----------------|
| **RandomForestRegressor** | Ensemble of decision trees for regression. | `n_estimators` (default 100), `max_depth` (default 10) |
| **RandomForestClassifier** | Ensemble of decision trees for classification. | `n_estimators` (default 100), `max_depth` (default 10) |
| **XGBoost** | Extreme Gradient Boosting. | `n_estimators` (default 100), `learning_rate` (default 0.1), `max_depth` (default 6) |
| **LightGBM** | Light Gradient Boosting Machine. | `n_estimators` (default 100), `learning_rate` (default 0.1), `num_leaves` (default 31) |

## Models -- Deep Learning

| Node | Description | Key parameters |
|------|-------------|----------------|
| **NICoN** | NIRS Convolutional Network designed for NIR spectroscopy. | `epochs`, `learning_rate`, `batch_size` |
| **CNN1D** | Generic 1D Convolutional Neural Network. | `epochs`, `learning_rate`, `n_filters`, `kernel_size` |
| **MLPRegressor** | Multi-Layer Perceptron for regression. | `hidden_layer_sizes`, `max_iter`, `learning_rate_init` |
| **LSTM** | Long Short-Term Memory recurrent network. | `epochs`, `hidden_size`, `num_layers`, `learning_rate` |
| **Transformer** | Attention-based transformer architecture. | `epochs`, `d_model`, `nhead`, `num_layers`, `learning_rate` |
| **TabPFN** | Pre-trained transformer for tabular data (no tuning needed). | *(none)* |

## Models -- Meta

| Node | Description | Key parameters |
|------|-------------|----------------|
| **MetaModel** | Meta-learner for stacking ensembles. Combines predictions from branch models. | `estimator`: ridge/lasso/pls/linear |
| **PCR** | Principal Component Regression (PCA + regression). | `n_components` (default 10) |

---

## Flow -- Branching

| Node | Description | Key parameters |
|------|-------------|----------------|
| **ParallelBranch** | Runs multiple pipeline branches in parallel. | Container with 2+ branches (accepts child steps). |
| **SourceBranch** | Per-source preprocessing for multi-source datasets. | `sources`: list of source names. |

## Flow -- Merge

| Node | Description | Key parameters |
|------|-------------|----------------|
| **MergePredictions** | Merges outputs from parallel branches. | `mode`: predictions (stacking), features, or average. |
| **MergeSources** | Merges data from source branches. | `axis`: features (columns) or samples (rows). |

---

## Generators (Utility)

| Node | Description | Key parameters |
|------|-------------|----------------|
| **ChooseOne** (`_or_`) | Generates variants by trying each item from a list. | `items`: list of steps to choose from. |
| **ChooseN** (`_and_`) | Generates variants by selecting N items from a list. | `items`: list of steps, `n`: number to select. |
| **Cartesian** (`_cartesian_`) | Creates all combinations from multiple lists (Cartesian product). | Container with 2+ stage lists. |
| **Range** (`_range_`) | Generates values over a linear range for parameter sweeping. | `from`, `to`, `step`, `param`: target parameter name. |

:::{tip}
Generators multiply the total number of pipeline variants. A pipeline with a ChooseOne(3 items) and a Range(10 values) produces 30 variants. The Pipeline Editor toolbar shows the total variant count.
:::

---

## Augmentation

Data augmentation nodes add synthetic variation to training spectra. All augmentation nodes support `variation_scope` (per-sample or per-batch).

| Node | Description | Key parameters |
|------|-------------|----------------|
| **GaussianAdditiveNoise** | Adds Gaussian random noise. | `sigma` (default 0.01), `smoothing_kernel_width` |
| **MultiplicativeNoise** | Applies multiplicative random noise. | `sigma`, `variation_scope` |
| **BaselineShift** | Adds random baseline offset. | `max_shift`, `variation_scope` |
| **WavelengthShift** | Shifts spectra along the wavelength axis. | `max_shift`, `variation_scope` |

:::{note}
This is a representative subset. The full augmentation library includes additional transforms for scattering simulation, environmental effects, edge artifacts, and spline-based deformations. See the Step Palette in the Pipeline Editor for the complete list.
:::

:::{seealso}
- {doc}`pipeline-editor-page` -- Using nodes in the visual pipeline builder
- {doc}`pipelines-page` -- Managing saved pipelines
:::
