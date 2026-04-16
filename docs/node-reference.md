# Node Reference

> Auto-generated from curated node definitions. 338 nodes total.

## Summary

| Type | Count | With Finetuning | With Sweep Presets |
|------|-------|-----------------|---------|
| Preprocessing | 103 | 49 | 16 |
| Models | 137 | 91 | 26 |
| Splitting | 24 | 0 | 0 |
| Augmentation | 39 | 24 | 0 |
| Y-Processing | 12 | 2 | 0 |
| Filters | 5 | 0 | 0 |
| Flow Control | 16 | 0 | 0 |
| Utilities | 2 | 0 | 0 |
| **Total** | **338** | **166** | **42** |

---

## Preprocessing

### Baseline

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Detrend** | nirs4all | core | `bp`=0 | `bp` [0-5] | - |
| **BaselineCorrection** | nirs4all | standard | - | - | - |
| **ASLSBaseline** | nirs4all | standard | `lam`=1000000, `p`=0.01 | `lam` [1000-100000000], `p` [0.001-0.1] | `lam`, `p` |
| **AirPLS** | nirs4all | standard | `lam`=1000000 | `lam` [1000-10000000] | `lam` |
| **ArPLS** | nirs4all | standard | `lam`=1000000 | `lam` [1000-10000000] | `lam` |
| **SNIP** | nirs4all | standard | `max_half_window`=40 | `max_half_window` [10-100] | `max_half_window` |
| **RollingBall** | nirs4all | standard | `half_window`=50 | `half_window` [10-100] | `half_window` |
| **ModPoly** | nirs4all | standard | `poly_order`=5 | `poly_order` [1-6] | `poly_order` |
| **IModPoly** | nirs4all | standard | `poly_order`=5 | `poly_order` [1-6] | `poly_order` |
| **BEADS** | nirs4all | standard | - | - | - |
| **IASLS** | nirs4all | standard | - | - | - |

### Conversion

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **ReflectanceToAbsorbance** | nirs4all | standard | `percent`=false | - | - |
| **LogTransform** | nirs4all | standard | `base` (e/10/2) | - | - |
| **ToAbsorbance** | nirs4all | standard | `source_type` (reflectance/transmittance) | - | - |
| **FromAbsorbance** | nirs4all | standard | `target_type` (reflectance/transmittance) | - | - |
| **KubelkaMunk** | nirs4all | standard | `source_type` (reflectance/transmittance) | - | - |
| **FractionToPercent** | nirs4all | standard | - | - | - |
| **PercentToFraction** | nirs4all | standard | - | - | - |
| **SignalTypeConverter** | nirs4all | standard | - | - | - |

### Derivatives

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **SavitzkyGolay** | nirs4all | core | `window_length`=11, `polyorder`=2, `deriv` (0/1/2) | `window_length` [5-51], `polyorder` [1-5] | `window_length`, `polyorder` |
| **FirstDerivative** | nirs4all | core | - | - | - |
| **SecondDerivative** | nirs4all | core | - | - | - |
| **Derivate** | nirs4all | standard | - | - | - |

### Dimensionality Reduction

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **PCA** | sklearn | standard | `n_components`=10 | `n_components` [1-50] | `n_components` |
| **TruncatedSVD** | sklearn | standard | `n_components`=10 | `n_components` [1-50] | `n_components` |
| **DictionaryLearning** | sklearn | advanced | `n_components` | `n_components` [1-30] | - |
| **FactorAnalysis** | sklearn | standard | `n_components` | `n_components` [1-30] | - |
| **FastICA** | sklearn | standard | `n_components`, `whiten`=unit-variance | `n_components` [1-30] | - |
| **IncrementalPCA** | sklearn | standard | `n_components`, `whiten`=false | `n_components` [1-30] | - |
| **Isomap** | sklearn | standard | `n_neighbors`=5, `n_components`=2 | `n_neighbors` [1-30], `n_components` [1-30] | - |
| **KernelPCA** | sklearn | standard | `n_components`, `degree`=3 | `n_components` [1-30], `degree` [2-5] | - |
| **LocallyLinearEmbedding** | sklearn | advanced | `n_neighbors`=5, `n_components`=2, `method` (barnes_hut/exact) | `n_neighbors` [1-30], `n_components` [1-30] | - |
| **MiniBatchDictionaryLearning** | sklearn | advanced | `n_components` | `n_components` [1-30] | - |
| **MiniBatchSparsePCA** | sklearn | advanced | `n_components`, `method` (barnes_hut/exact) | `n_components` [1-30] | - |
| **PLSSVD** | sklearn | advanced | - | - | - |
| **SparsePCA** | sklearn | standard | `n_components`, `method` (barnes_hut/exact) | `n_components` [1-30] | - |
| **TSNE** | sklearn | standard | `n_components`=2, `perplexity`=30, `method` (barnes_hut/exact) | `n_components` [1-30], `perplexity` [5-50] | - |

### Feature Engineering

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **CropTransformer** | nirs4all | standard | `start`=0, `end`=-1 | - | - |
| **Resampler** | nirs4all | standard | `n_points`=512 | - | - |
| **FlattenPreprocessing** | nirs4all | advanced | - | - | - |

### Scaling

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Normalize** | sklearn | standard | `norm` (l1/l2/max) | - | - |
| **StandardScaler** | sklearn | core | `with_mean`=true, `with_std`=true | - | - |
| **MinMaxScaler** | sklearn | core | `feature_range_min`=0, `feature_range_max`=1 | - | - |
| **RobustScaler** | sklearn | standard | `with_centering`=true, `with_scaling`=true | - | - |
| **MaxAbsScaler** | sklearn | standard | - | - | - |
| **AreaNormalization** | nirs4all | standard | `method` (sum/abs_sum/trapz) | - | - |
| **SimpleScale** | nirs4all | standard | - | - | - |
| **Binarizer** | sklearn | standard | `threshold`=0 | - | - |
| **FunctionTransformer** | sklearn | standard | - | - | - |
| **Normalizer** | sklearn | core | `norm` (l1/l2/max) | - | - |
| **PolynomialFeatures** | sklearn | standard | `degree`=2 | `degree` [2-5] | - |
| **SplineTransformer** | sklearn | standard | `n_knots`=5, `degree`=3 | `n_knots` [3-20], `degree` [2-5] | - |

### Feature Selection

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **CARS** | nirs4all | advanced | `n_pls_components`=10, `n_sampling_runs`=50 | `n_pls_components` [5-30] | `n_pls_components` |
| **MCUVE** | nirs4all | advanced | `n_components`=10, `n_iterations`=100 | `n_components` [5-30] | `n_components` |
| **FlexiblePCA** | nirs4all | standard | `n_components`=0.95, `whiten`=false | `n_components` [1-30] | - |
| **FlexibleSVD** | nirs4all | standard | `n_components`=0.95 | `n_components` [1-30] | - |
| **GenericUnivariateSelect** | sklearn | advanced | - | - | - |
| **RFE** | sklearn | standard | - | - | - |
| **RFECV** | sklearn | standard | - | - | - |
| **SelectFdr** | sklearn | advanced | - | - | - |
| **SelectFpr** | sklearn | advanced | - | - | - |
| **SelectFromModel** | sklearn | standard | `threshold` | - | - |
| **SelectFwe** | sklearn | advanced | - | - | - |
| **SelectKBest** | sklearn | core | - | - | - |
| **SelectPercentile** | sklearn | standard | - | - | - |
| **SequentialFeatureSelector** | sklearn | standard | - | - | - |
| **VarianceThreshold** | sklearn | core | `threshold`=0 | - | - |

### NIRS Core

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **SNV** | nirs4all | core | - | - | - |
| **RobustSNV** | nirs4all | standard | - | - | - |
| **LocalSNV** | nirs4all | standard | `window`=11 | `window` [5-51] | `window` |
| **MSC** | nirs4all | core | - | - | - |
| **EMSC** | nirs4all | standard | `degree`=2 | `degree` [0-4] | - |
| **OSC** | nirs4all | standard | `n_components`=2 | `n_components` [1-10] | - |
| **NorrisWilliams** | nirs4all | standard | `gap`=1, `segment`=1, `deriv`=1 | `gap` [1-20], `segment` [1-20] | - |

### Clustering & Neighbors

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Birch** | sklearn | advanced | `threshold`=0.5, `n_clusters`=3 | `n_clusters` [2-20] | - |
| **BisectingKMeans** | sklearn | advanced | `n_clusters`=8 | `n_clusters` [2-20] | - |
| **FeatureAgglomeration** | sklearn | standard | `n_clusters`=2 | `n_clusters` [2-20] | - |
| **KMeans** | sklearn | standard | `n_clusters`=8 | `n_clusters` [2-20] | - |
| **KNeighborsTransformer** | sklearn | advanced | `n_neighbors`=5 | `n_neighbors` [1-30] | - |
| **MiniBatchKMeans** | sklearn | advanced | `n_clusters`=8 | `n_clusters` [2-20] | - |
| **RadiusNeighborsTransformer** | sklearn | advanced | - | - | - |

### Encoding

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **KBinsDiscretizer** | sklearn | standard | `n_bins`=5, `encode` (onehot/onehot-dense/ordinal), `strategy` (mean/median/most_frequent/constant/uniform/quantile/kmeans) | `n_bins` [2-20] | - |
| **OneHotEncoder** | sklearn | advanced | - | - | - |
| **OrdinalEncoder** | sklearn | advanced | - | - | - |
| **TargetEncoder** | sklearn | advanced | - | - | - |

### Imputation

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **KNNImputer** | sklearn | standard | `n_neighbors`=5 | `n_neighbors` [1-30] | - |
| **MissingIndicator** | sklearn | advanced | - | - | - |
| **SimpleImputer** | sklearn | core | `strategy` (mean/median/most_frequent/constant/uniform/quantile/kmeans) | - | - |

### Kernel Projection

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **AdditiveChi2Sampler** | sklearn | advanced | - | - | - |
| **Nystroem** | sklearn | standard | `degree`, `n_components`=100 | `degree` [2-5], `n_components` [1-30] | - |
| **PolynomialCountSketch** | sklearn | advanced | `degree`=2, `n_components`=100 | `degree` [2-5], `n_components` [1-30] | - |
| **RBFSampler** | sklearn | standard | `n_components`=100 | `n_components` [1-30] | - |
| **SkewedChi2Sampler** | sklearn | advanced | `n_components`=100 | `n_components` [1-30] | - |

### Other

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **BernoulliRBM** | sklearn | advanced | `n_components`=256 | `n_components` [1-30] | - |
| **RandomTreesEmbedding** | sklearn | advanced | - | - | - |

### Smoothing

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Gaussian** | nirs4all | standard | `sigma`=1 | `sigma` [0.5-10] | `sigma` |
| **MovingAverage** | nirs4all | standard | `window_length`=5 | `window_length` [3-31] | `window_length` |

### Wavelet

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Haar** | nirs4all | standard | - | - | - |
| **Wavelet** | nirs4all | standard | `wavelet` (haar/db4/db6/db8/sym4/sym6/coif1/coif3) | - | - |
| **WaveletPCA** | nirs4all | advanced | `n_components_per_level`=3, `wavelet` (haar/db4/db6/db8/sym4/sym6/coif1/coif3) | `n_components_per_level` [5-50] | `n_components_per_level` |
| **WaveletFeatures** | nirs4all | standard | - | - | - |
| **WaveletSVD** | nirs4all | standard | - | - | - |
| **WaveletDenoise** | nirs4all | standard | `wavelet` (haar/db4/db6/db8/sym4/sym6/coif1), `level`=3 | `level` [1-7] | - |

---

## Models

### Advanced PLS

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **OPLS** | nirs4all | standard | `n_components`=10 | `n_components` [1-20] | `n_components` |
| **OPLSDA** | nirs4all | standard | `n_components`=10 | `n_components` [1-20] | `n_components` |
| **IKPLS** | nirs4all | standard | `n_components`=10 | `n_components` [1-30] | `n_components` |
| **SparsePLS** | nirs4all | standard | `n_components`=10, `alpha`=0.1 | `n_components` [1-20], `alpha` [0.001-1] | `n_components` |
| **LWPLS** | nirs4all | advanced | `n_components`=10, `n_neighbors`=50 | `n_components` [1-20], `n_neighbors` [10-100] | `n_components` |
| **IntervalPLS** | nirs4all | advanced | `n_components`=10, `n_intervals`=20 | `n_components` [1-20], `n_intervals` [5-40] | `n_components` |
| **RobustPLS** | nirs4all | advanced | `n_components`=10 | `n_components` [1-20] | `n_components` |
| **SIMPLS** | nirs4all | standard | `n_components`=10 | `n_components` [1-30] | `n_components` |
| **DiPLS** | nirs4all | advanced | `n_components`=10 | `n_components` [1-20] | `n_components` |
| **RecursivePLS** | nirs4all | advanced | `n_components`=10 | `n_components` [1-20], `forgetting_factor` [0.9-1] | `n_components` |
| **AOMPLSRegressor** | nirs4all | advanced | `n_components`=10 | `n_components` [1-30] | `n_components` |
| **AOMPLSClassifier** | nirs4all | advanced | `n_components`=10 | `n_components` [1-30] | - |
| **POPPLSRegressor** | nirs4all | advanced | `n_components`=10 | `n_components` [1-30] | `n_components` |
| **POPPLSClassifier** | nirs4all | advanced | `n_components`=10 | `n_components` [1-30] | - |

### Deep Learning

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **NICoN** | nirs4all | advanced | `epochs`=100, `learning_rate`=0.001, `batch_size`=32 | `epochs` [50-500], `learning_rate` [0.0001-0.01] | - |
| **NICoNClassifier** | nirs4all | advanced | `epochs`=100, `learning_rate`=0.001, `batch_size`=32 | `epochs` [50-500], `learning_rate` [0.0001-0.01] | - |
| **CNN1D** | nirs4all | advanced | `epochs`=100, `learning_rate`=0.001, `n_filters`=32, `kernel_size`=7 | `epochs` [50-500], `learning_rate` [0.0001-0.01] | - |
| **CNN1DClassifier** | nirs4all | advanced | `epochs`=100, `learning_rate`=0.001, `n_filters`=32, `kernel_size`=7 | `epochs` [50-500], `learning_rate` [0.0001-0.01] | - |
| **MLPRegressor** | sklearn | advanced | `hidden_layer_sizes`=(100, 50), `max_iter`=200, `learning_rate_init`=0.001 | `learning_rate_init` [0.0001-0.01] | - |
| **Transformer** | nirs4all | advanced | `epochs`=100, `d_model`=64, `nhead`=4, `num_layers`=2, `learning_rate`=0.001 | `epochs` [50-500], `learning_rate` [0.0001-0.01] | - |
| **TransformerClassifier** | nirs4all | advanced | `epochs`=100, `d_model`=64, `nhead`=4, `num_layers`=2, `learning_rate`=0.001 | `epochs` [50-500], `learning_rate` [0.0001-0.01] | - |
| **TabPFN** | nirs4all | advanced | - | - | - |
| **TabPFNClassifier** | nirs4all | advanced | - | - | - |
| **TabICLRegressor** | nirs4all | advanced | - | - | - |
| **TabICLClassifier** | nirs4all | advanced | - | - | - |

### Ensemble

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **RandomForestRegressor** | sklearn | core | `n_estimators`=100, `max_depth`=10 | `n_estimators` [50-500], `max_depth` [3-30] | `n_estimators`, `max_depth` |
| **RandomForestClassifier** | sklearn | standard | `n_estimators`=100, `max_depth`=10 | `n_estimators` [50-500], `max_depth` [3-30] | `n_estimators`, `max_depth` |
| **XGBoost** | sklearn | standard | `n_estimators`=100, `learning_rate`=0.1, `max_depth`=6 | `n_estimators` [50-500], `learning_rate` [0.01-0.5], `max_depth` [3-15] | `n_estimators`, `learning_rate`, `max_depth` |
| **XGBoostClassifier** | sklearn | standard | `n_estimators`=100, `learning_rate`=0.1, `max_depth`=6 | `n_estimators` [50-500], `learning_rate` [0.01-0.5], `max_depth` [3-15] | `n_estimators`, `learning_rate`, `max_depth` |
| **LightGBM** | sklearn | standard | `n_estimators`=100, `learning_rate`=0.1, `num_leaves`=31 | `n_estimators` [50-500], `learning_rate` [0.01-0.5], `num_leaves` [10-100] | `n_estimators`, `learning_rate`, `num_leaves` |
| **LightGBMClassifier** | sklearn | standard | `n_estimators`=100, `learning_rate`=0.1, `num_leaves`=31 | `n_estimators` [50-500], `learning_rate` [0.01-0.5], `num_leaves` [10-100] | `n_estimators`, `learning_rate`, `num_leaves` |

### Kernel PLS

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **KernelPLS** | nirs4all | advanced | `n_components`=10, `kernel` (rbf/linear/poly), `gamma`=1 | `n_components` [1-20], `gamma` [0.001-10] | - |
| **KOPLS** | nirs4all | advanced | `n_components`=10, `kernel` (rbf/linear/poly), `gamma` | `n_components` [1-20], `gamma` [0.001-10] | - |
| **NLPLS** | nirs4all | advanced | `n_components`=10, `kernel` (rbf/linear/poly), `gamma` | `n_components` [1-20], `gamma` [0.001-10] | - |
| **FCKPLS** | nirs4all | advanced | `n_components`=10 | `n_components` [1-20] | - |

### Linear

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Ridge** | sklearn | core | `alpha`=1 | `alpha` [0.001-100] | `alpha` |
| **Lasso** | sklearn | standard | `alpha`=1 | `alpha` [0.001-100] | `alpha` |
| **ElasticNet** | sklearn | standard | `alpha`=1, `l1_ratio`=0.5 | `alpha` [0.001-100], `l1_ratio` [0.1-0.9] | `alpha`, `l1_ratio` |

### Meta

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **MetaModel** | nirs4all | standard | `estimator` (ridge/lasso/pls/linear) | - | - |
| **PCR** | nirs4all | standard | `n_components`=10 | `n_components` [1-30] | `n_components` |

### PLS

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **PLSRegression** | sklearn | core | `n_components`=10 | `n_components` [1-30] | `n_components` |
| **PLSDA** | nirs4all | standard | `n_components`=10 | `n_components` [1-30] | `n_components` |
| **KPLS** | nirs4all | advanced | `n_components`=10, `kernel` (rbf/linear/poly/sigmoid), `gamma`, `degree`=3 | `n_components` [1-30], `gamma` [0.001-10], `degree` [2-5] | - |
| **MBPLS** | nirs4all | advanced | `n_components`=5 | `n_components` [1-30] | - |
| **OKLMPLS** | nirs4all | advanced | `n_components`=5 | `n_components` [1-30] | - |

### sklearn-discriminant

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **LinearDiscriminantAnalysis** | sklearn | standard | `solver` (auto/svd/lsqr/saga/lbfgs/adam/sgd), `n_components` | `n_components` [1-30] | - |
| **QuadraticDiscriminantAnalysis** | sklearn | standard | `solver` (auto/svd/lsqr/saga/lbfgs/adam/sgd) | - | - |

### sklearn-ensemble

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **AdaBoostClassifier** | sklearn | standard | `n_estimators`=50, `learning_rate`=1 | `n_estimators` [10-500], `learning_rate` [0.001-1] | - |
| **AdaBoostRegressor** | sklearn | standard | `n_estimators`=50, `learning_rate`=1, `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge) | `n_estimators` [10-500], `learning_rate` [0.001-1] | - |
| **BaggingClassifier** | sklearn | standard | `n_estimators`=10, `max_features`=1 | `n_estimators` [10-500] | - |
| **BaggingRegressor** | sklearn | standard | `n_estimators`=10, `max_features`=1 | `n_estimators` [10-500] | - |
| **ExtraTreesClassifier** | sklearn | standard | `n_estimators`=100, `criterion` (squared_error/friedman_mse/absolute_error/poisson/gini/entropy/log_loss), `max_depth`, `min_samples_split`=2, `min_samples_leaf`=1, `max_features`=sqrt | `n_estimators` [10-500], `max_depth` [2-30], `min_samples_split` [2-20], `min_samples_leaf` [1-20] | - |
| **ExtraTreesRegressor** | sklearn | standard | `n_estimators`=100, `criterion` (squared_error/friedman_mse/absolute_error/poisson/gini/entropy/log_loss), `max_depth`, `min_samples_split`=2, `min_samples_leaf`=1, `max_features`=1 | `n_estimators` [10-500], `max_depth` [2-30], `min_samples_split` [2-20], `min_samples_leaf` [1-20] | - |
| **GradientBoostingClassifier** | sklearn | standard | `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge), `learning_rate`=0.1, `n_estimators`=100, `subsample`=1, `criterion` (squared_error/friedman_mse/absolute_error/poisson/gini/entropy/log_loss), `min_samples_split`=2, `min_samples_leaf`=1, `max_depth`=3, `max_features` | `learning_rate` [0.001-1], `n_estimators` [10-500], `subsample` [0.5-1], `min_samples_split` [2-20], `min_samples_leaf` [1-20], `max_depth` [2-30] | - |
| **GradientBoostingRegressor** | sklearn | core | `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge), `learning_rate`=0.1, `n_estimators`=100, `subsample`=1, `criterion` (squared_error/friedman_mse/absolute_error/poisson/gini/entropy/log_loss), `min_samples_split`=2, `min_samples_leaf`=1, `max_depth`=3, `max_features`, `alpha`=0.9 | `learning_rate` [0.001-1], `n_estimators` [10-500], `subsample` [0.5-1], `min_samples_split` [2-20], `min_samples_leaf` [1-20], `max_depth` [2-30], `alpha` [0.0001-10] | - |
| **HistGradientBoostingClassifier** | sklearn | standard | `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge), `learning_rate`=0.1, `max_depth`, `min_samples_leaf`=20, `max_features`=1 | `learning_rate` [0.001-1], `max_depth` [2-30], `min_samples_leaf` [1-20] | - |
| **HistGradientBoostingRegressor** | sklearn | standard | `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge), `learning_rate`=0.1, `max_depth`, `min_samples_leaf`=20, `max_features`=1 | `learning_rate` [0.001-1], `max_depth` [2-30], `min_samples_leaf` [1-20] | - |
| **StackingClassifier** | sklearn | standard | - | - | - |
| **StackingRegressor** | sklearn | standard | - | - | - |
| **VotingClassifier** | sklearn | standard | - | - | - |
| **VotingRegressor** | sklearn | standard | - | - | - |

### sklearn-gaussian-process

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **GaussianProcessClassifier** | sklearn | standard | `kernel` (rbf/linear/poly/sigmoid) | - | - |
| **GaussianProcessRegressor** | sklearn | standard | `kernel` (rbf/linear/poly/sigmoid), `alpha`=1e-10 | `alpha` [0.0001-10] | - |

### sklearn-linear

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **ARDRegression** | sklearn | standard | - | - | - |
| **BayesianRidge** | sklearn | standard | - | - | - |
| **ElasticNetCV** | sklearn | standard | `l1_ratio`=0.5 | `l1_ratio` [0-1] | - |
| **GammaRegressor** | sklearn | advanced | `alpha`=1, `solver` (auto/svd/lsqr/saga/lbfgs/adam/sgd) | `alpha` [0.0001-10] | - |
| **HuberRegressor** | sklearn | standard | `epsilon`=1.35, `alpha`=0.0001 | `epsilon` [0.001-1], `alpha` [0.0001-10] | - |
| **Lars** | sklearn | standard | - | - | - |
| **LarsCV** | sklearn | advanced | - | - | - |
| **LassoCV** | sklearn | standard | - | - | - |
| **LassoLars** | sklearn | standard | `alpha`=1 | `alpha` [0.0001-10] | - |
| **LassoLarsCV** | sklearn | advanced | - | - | - |
| **LassoLarsIC** | sklearn | advanced | `criterion` (squared_error/friedman_mse/absolute_error/poisson/gini/entropy/log_loss) | - | - |
| **LinearRegression** | sklearn | core | - | - | - |
| **LogisticRegression** | sklearn | core | `penalty` (l1/l2/elasticnet/none), `C`=1, `l1_ratio`=0, `solver` (auto/svd/lsqr/saga/lbfgs/adam/sgd) | `C` [0.01-100], `l1_ratio` [0-1] | - |
| **LogisticRegressionCV** | sklearn | advanced | `penalty` (l1/l2/elasticnet/none), `solver` (auto/svd/lsqr/saga/lbfgs/adam/sgd) | - | - |
| **MultiTaskElasticNet** | sklearn | advanced | `alpha`=1, `l1_ratio`=0.5 | `alpha` [0.0001-10], `l1_ratio` [0-1] | - |
| **MultiTaskElasticNetCV** | sklearn | advanced | `l1_ratio`=0.5 | `l1_ratio` [0-1] | - |
| **MultiTaskLasso** | sklearn | advanced | `alpha`=1 | `alpha` [0.0001-10] | - |
| **MultiTaskLassoCV** | sklearn | advanced | - | - | - |
| **OrthogonalMatchingPursuit** | sklearn | advanced | - | - | - |
| **OrthogonalMatchingPursuitCV** | sklearn | advanced | - | - | - |
| **PassiveAggressiveClassifier** | sklearn | advanced | `C`=1, `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge) | `C` [0.01-100] | - |
| **PassiveAggressiveRegressor** | sklearn | advanced | `C`=1, `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge), `epsilon`=0.1 | `C` [0.01-100], `epsilon` [0.001-1] | - |
| **Perceptron** | sklearn | advanced | `penalty` (l1/l2/elasticnet/none), `alpha`=0.0001, `l1_ratio`=0.15 | `alpha` [0.0001-10], `l1_ratio` [0-1] | - |
| **PoissonRegressor** | sklearn | advanced | `alpha`=1, `solver` (auto/svd/lsqr/saga/lbfgs/adam/sgd) | `alpha` [0.0001-10] | - |
| **QuantileRegressor** | sklearn | standard | `alpha`=1, `solver` (auto/svd/lsqr/saga/lbfgs/adam/sgd) | `alpha` [0.0001-10] | - |
| **RANSACRegressor** | sklearn | standard | `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge) | - | - |
| **RidgeClassifier** | sklearn | advanced | `alpha`=1, `solver` (auto/svd/lsqr/saga/lbfgs/adam/sgd) | `alpha` [0.0001-10] | - |
| **RidgeClassifierCV** | sklearn | advanced | - | - | - |
| **RidgeCV** | sklearn | standard | - | - | - |
| **SGDClassifier** | sklearn | standard | `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge), `penalty` (l1/l2/elasticnet/none), `alpha`=0.0001, `l1_ratio`=0.15, `epsilon`=0.1, `learning_rate`=optimal | `alpha` [0.0001-10], `l1_ratio` [0-1], `epsilon` [0.001-1], `learning_rate` [0.001-1] | - |
| **SGDRegressor** | sklearn | standard | `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge), `penalty` (l1/l2/elasticnet/none), `alpha`=0.0001, `l1_ratio`=0.15, `epsilon`=0.1, `learning_rate`=invscaling | `alpha` [0.0001-10], `l1_ratio` [0-1], `epsilon` [0.001-1], `learning_rate` [0.001-1] | - |
| **TheilSenRegressor** | sklearn | standard | - | - | - |
| **TweedieRegressor** | sklearn | advanced | `alpha`=1, `solver` (auto/svd/lsqr/saga/lbfgs/adam/sgd) | `alpha` [0.0001-10] | - |

### sklearn-meta

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **ClassifierChain** | sklearn | advanced | - | - | - |
| **MultiOutputClassifier** | sklearn | advanced | - | - | - |
| **MultiOutputRegressor** | sklearn | advanced | - | - | - |
| **OneVsOneClassifier** | sklearn | advanced | - | - | - |
| **OneVsRestClassifier** | sklearn | advanced | - | - | - |
| **OutputCodeClassifier** | sklearn | advanced | - | - | - |
| **RegressorChain** | sklearn | advanced | - | - | - |

### sklearn-probabilistic

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **CalibratedClassifierCV** | sklearn | advanced | - | - | - |
| **FixedThresholdClassifier** | sklearn | advanced | - | - | - |
| **IsotonicRegression** | sklearn | advanced | - | - | - |
| **TunedThresholdClassifierCV** | sklearn | advanced | - | - | - |

### sklearn-cross-decomposition

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **CCA** | sklearn | standard | `n_components`=2 | `n_components` [1-30] | - |
| **PLSCanonical** | sklearn | standard | `n_components`=2 | `n_components` [1-30] | - |

### sklearn-baseline

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **DummyClassifier** | sklearn | standard | - | - | - |
| **DummyRegressor** | sklearn | standard | - | - | - |

### sklearn-kernel

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **KernelRidge** | sklearn | standard | `alpha`=1, `kernel` (rbf/linear/poly/sigmoid), `gamma`, `degree`=3 | `alpha` [0.0001-10], `gamma` [0.001-10], `degree` [2-5] | - |

### sklearn-semi-supervised

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **LabelPropagation** | sklearn | advanced | `kernel` (rbf/linear/poly/sigmoid), `gamma`=20, `n_neighbors`=7 | `gamma` [0.001-10], `n_neighbors` [1-30] | - |
| **LabelSpreading** | sklearn | advanced | `kernel` (rbf/linear/poly/sigmoid), `gamma`=20, `n_neighbors`=7, `alpha`=0.2 | `gamma` [0.001-10], `n_neighbors` [1-30], `alpha` [0.0001-10] | - |
| **SelfTrainingClassifier** | sklearn | advanced | `criterion` (squared_error/friedman_mse/absolute_error/poisson/gini/entropy/log_loss) | - | - |

### sklearn-misc-models

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **TransformedTargetRegressor** | sklearn | advanced | - | - | - |

### sklearn-naive-bayes

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **BernoulliNB** | sklearn | standard | `alpha`=1 | `alpha` [0.0001-10] | - |
| **CategoricalNB** | sklearn | advanced | `alpha`=1 | `alpha` [0.0001-10] | - |
| **ComplementNB** | sklearn | advanced | `alpha`=1 | `alpha` [0.0001-10] | - |
| **GaussianNB** | sklearn | core | - | - | - |
| **MultinomialNB** | sklearn | advanced | `alpha`=1 | `alpha` [0.0001-10] | - |

### sklearn-neighbors

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **KNeighborsClassifier** | sklearn | standard | `n_neighbors`=5 | `n_neighbors` [1-30] | - |
| **KNeighborsRegressor** | sklearn | core | `n_neighbors`=5 | `n_neighbors` [1-30] | - |
| **NearestCentroid** | sklearn | advanced | - | - | - |
| **RadiusNeighborsClassifier** | sklearn | advanced | - | - | - |
| **RadiusNeighborsRegressor** | sklearn | advanced | - | - | - |

### sklearn-neural

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **MLPClassifier** | sklearn | standard | `hidden_layer_sizes`=100, `activation` (relu/identity/logistic/tanh), `solver` (auto/svd/lsqr/saga/lbfgs/adam/sgd), `alpha`=0.0001, `learning_rate`=constant, `epsilon`=1e-8 | `alpha` [0.0001-10], `learning_rate` [0.001-1], `epsilon` [0.001-1] | - |

### sklearn-svm

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **LinearSVC** | sklearn | standard | `penalty` (l1/l2/elasticnet/none), `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge), `C`=1 | `C` [0.01-100] | - |
| **LinearSVR** | sklearn | standard | `epsilon`=0, `C`=1, `loss` (squared_error/absolute_error/huber/quantile/log_loss/hinge) | `epsilon` [0.001-1], `C` [0.01-100] | - |
| **NuSVC** | sklearn | standard | `kernel` (rbf/linear/poly/sigmoid), `degree`=3, `gamma`=scale | `degree` [2-5], `gamma` [0.001-10] | - |
| **NuSVR** | sklearn | standard | `C`=1, `kernel` (rbf/linear/poly/sigmoid), `degree`=3, `gamma`=scale | `C` [0.01-100], `degree` [2-5], `gamma` [0.001-10] | - |

### sklearn-tree

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **DecisionTreeClassifier** | sklearn | standard | `criterion` (squared_error/friedman_mse/absolute_error/poisson/gini/entropy/log_loss), `max_depth`, `min_samples_split`=2, `min_samples_leaf`=1, `max_features` | `max_depth` [2-30], `min_samples_split` [2-20], `min_samples_leaf` [1-20] | - |
| **DecisionTreeRegressor** | sklearn | core | `criterion` (squared_error/friedman_mse/absolute_error/poisson/gini/entropy/log_loss), `max_depth`, `min_samples_split`=2, `min_samples_leaf`=1, `max_features` | `max_depth` [2-30], `min_samples_split` [2-20], `min_samples_leaf` [1-20] | - |
| **ExtraTreeClassifier** | sklearn | standard | `criterion` (squared_error/friedman_mse/absolute_error/poisson/gini/entropy/log_loss), `max_depth`, `min_samples_split`=2, `min_samples_leaf`=1, `max_features`=sqrt | `max_depth` [2-30], `min_samples_split` [2-20], `min_samples_leaf` [1-20] | - |
| **ExtraTreeRegressor** | sklearn | standard | `criterion` (squared_error/friedman_mse/absolute_error/poisson/gini/entropy/log_loss), `max_depth`, `min_samples_split`=2, `min_samples_leaf`=1, `max_features`=1 | `max_depth` [2-30], `min_samples_split` [2-20], `min_samples_leaf` [1-20] | - |

### SVM

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **SVR** | sklearn | core | `kernel` (rbf/linear/poly/sigmoid), `C`=1, `epsilon`=0.1 | `C` [0.01-100], `epsilon` [0.01-0.5] | `C`, `epsilon` |
| **SVC** | sklearn | standard | `kernel` (rbf/linear/poly/sigmoid), `C`=1 | `C` [0.1-100] | `C` |

---

## Splitting

### NIRS

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **KennardStone** | nirs4all | core | `test_size`=0.2, `metric` (euclidean/mahalanobis/cosine) | - | - |
| **SPXY** | nirs4all | standard | `test_size`=0.2 | - | - |
| **SPXYGFold** | nirs4all | standard | `n_splits`=5 | - | - |
| **KMeansSplitter** | nirs4all | standard | `n_clusters`=5, `test_size`=0.2 | - | - |
| **SPlitSplitter** | nirs4all | standard | `test_size`=0.2 | - | - |
| **KBinsStratifiedSplitter** | nirs4all | standard | `n_bins`=5, `test_size`=0.2 | - | - |
| **BinnedStratifiedGroupKFold** | nirs4all | standard | `n_splits`=5, `n_bins`=5 | - | - |
| **SystematicCircularSplitter** | nirs4all | standard | `test_size`=0.2 | - | - |
| **SPXYFold** | nirs4all | standard | `n_splits`=5 | - | - |

### Scikit-learn

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **KFold** | sklearn | core | `n_splits`=5, `shuffle`=true | - | - |
| **RepeatedKFold** | sklearn | standard | `n_splits`=5, `n_repeats`=3 | - | - |
| **ShuffleSplit** | sklearn | standard | `n_splits`=10, `test_size`=0.2 | - | - |
| **StratifiedKFold** | sklearn | standard | `n_splits`=5, `shuffle`=true | - | - |
| **LeaveOneOut** | sklearn | standard | - | - | - |
| **GroupKFold** | sklearn | standard | `n_splits`=5 | - | - |
| **GroupShuffleSplit** | sklearn | standard | `n_splits`=5, `test_size`=0.2 | - | - |
| **LeaveOneGroupOut** | sklearn | standard | - | - | - |
| **LeavePGroupsOut** | sklearn | advanced | `n_groups`=2 | - | - |
| **LeavePOut** | sklearn | advanced | `p`=1 | - | - |
| **PredefinedSplit** | sklearn | advanced | - | - | - |
| **RepeatedStratifiedKFold** | sklearn | standard | `n_splits`=5, `n_repeats`=10 | - | - |
| **StratifiedGroupKFold** | sklearn | standard | `n_splits`=5, `shuffle`=false | - | - |
| **StratifiedShuffleSplit** | sklearn | standard | `n_splits`=10, `test_size` | - | - |
| **TimeSeriesSplit** | sklearn | standard | `n_splits`=5, `max_train_size`, `test_size`, `gap`=0 | - | - |

---

## Augmentation

### Noise

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **GaussianAdditiveNoise** | nirs4all | core | `sigma`=0.01, `smoothing_kernel_width`=1, `variation_scope` (sample/batch) | `sigma` [0.001-0.1] | - |
| **MultiplicativeNoise** | nirs4all | standard | `sigma_gain`=0.05, `per_wavelength`=false, `variation_scope` (sample/batch) | `sigma_gain` [0.01-0.2] | - |
| **SpikeNoise** | nirs4all | standard | `n_spikes_range_min`=1, `n_spikes_range_max`=3, `amplitude_range_min`=-0.5, `amplitude_range_max`=0.5, `variation_scope` (sample/batch) | - | - |
| **HeteroscedasticNoiseAugmenter** | nirs4all | standard | `noise_base`=0.001, `noise_signal_dep`=0.005, `variation_scope` (sample/batch) | - | - |

### Baseline

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **LinearBaselineDrift** | nirs4all | standard | `offset_range_min`=-0.1, `offset_range_max`=0.1, `slope_range_min`=-0.001, `slope_range_max`=0.001, `variation_scope` (sample/batch) | `offset_range_max` [0.01-0.5], `slope_range_max` [0.0001-0.01] | - |
| **PolynomialBaselineDrift** | nirs4all | standard | `degree`=3, `variation_scope` (sample/batch) | `degree` [1-5] | - |

### Wavelength

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **WavelengthShift** | nirs4all | core | `shift_range_min`=-2, `shift_range_max`=2, `variation_scope` (sample/batch) | `shift_range_max` [0.5-5] | - |
| **WavelengthStretch** | nirs4all | standard | `stretch_range_min`=0.99, `stretch_range_max`=1.01, `variation_scope` (sample/batch) | `stretch_range_max` [1.001-1.1] | - |
| **LocalWavelengthWarp** | nirs4all | standard | `n_control_points`=5, `max_shift`=1, `variation_scope` (sample/batch) | `max_shift` [0.1-3] | - |
| **SmoothMagnitudeWarp** | nirs4all | standard | `n_control_points`=5, `gain_range_min`=0.9, `gain_range_max`=1.1, `variation_scope` (sample/batch) | `n_control_points` [3-10] | - |

### Spectral

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **BandPerturbation** | nirs4all | standard | `n_bands`=3, `bandwidth_range_min`=5, `bandwidth_range_max`=20, `gain_range_min`=0.9, `gain_range_max`=1.1, `offset_range_min`=-0.01, `offset_range_max`=0.01, `variation_scope` (sample/batch) | `n_bands` [1-10] | - |
| **GaussianSmoothingJitter** | nirs4all | standard | `sigma_range_min`=0.5, `sigma_range_max`=2, `kernel_width`=11, `variation_scope` (sample/batch) | `kernel_width` [3-21] | - |
| **UnsharpSpectralMask** | nirs4all | standard | `amount_range_min`=0.1, `amount_range_max`=0.5, `sigma`=1, `kernel_width`=11, `variation_scope` (sample/batch) | `sigma` [0.5-5] | - |
| **BandMasking** | nirs4all | standard | `n_bands_range_min`=1, `n_bands_range_max`=3, `bandwidth_range_min`=5, `bandwidth_range_max`=20, `mode` (interp/zero), `variation_scope` (sample/batch) | - | - |
| **ChannelDropout** | nirs4all | standard | `dropout_prob`=0.01, `mode` (interp/zero), `variation_scope` (sample/batch) | `dropout_prob` [0.005-0.1] | - |
| **LocalClipping** | nirs4all | standard | `n_regions`=1, `width_range_min`=5, `width_range_max`=20, `variation_scope` (sample/batch) | `n_regions` [1-5] | - |

### Mixing

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **MixupAugmenter** | nirs4all | core | `alpha`=0.2, `variation_scope` (sample/batch) | `alpha` [0.1-0.5] | - |
| **LocalMixupAugmenter** | nirs4all | standard | `alpha`=0.2, `k_neighbors`=5, `variation_scope` (sample/batch) | `alpha` [0.1-0.5], `k_neighbors` [3-15] | - |

### Scattering

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **ScatterSimulationMSC** | nirs4all | standard | `reference_mode` (self/global_mean), `a_range_min`=-0.1, `a_range_max`=0.1, `b_range_min`=0.9, `b_range_max`=1.1, `variation_scope` (sample/batch) | - | - |
| **ParticleSizeAugmenter** | nirs4all | advanced | `mean_size_um`=50, `size_variation_um`=15, `wavelength_exponent`=1.5, `size_effect_strength`=0.1, `include_path_length`=true, `variation_scope` (sample/batch) | `size_effect_strength` [0.01-0.5] | - |
| **EMSCDistortionAugmenter** | nirs4all | advanced | `multiplicative_range_min`=0.9, `multiplicative_range_max`=1.1, `additive_range_min`=-0.05, `additive_range_max`=0.05, `polynomial_order`=2, `polynomial_strength`=0.02, `variation_scope` (sample/batch) | `polynomial_strength` [0.005-0.1] | - |

### Environmental

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **TemperatureAugmenter** | nirs4all | advanced | `temperature_delta`=5, `enable_shift`=true, `enable_intensity`=true, `enable_broadening`=true, `variation_scope` (sample/batch) | `temperature_delta` [1-20] | - |
| **MoistureAugmenter** | nirs4all | advanced | `water_activity_delta`=0.1, `enable_shift`=true, `enable_intensity`=true, `variation_scope` (sample/batch) | `water_activity_delta` [0.01-0.5] | - |

### Edge Artifacts

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **DetectorRollOffAugmenter** | nirs4all | advanced | `detector_model` (generic_nir/ingaas_standard/ingaas_extended/pbs/silicon_ccd), `effect_strength`=1, `noise_amplification`=0.02, `include_baseline_distortion`=true, `variation_scope` (sample/batch) | `effect_strength` [0.1-2] | - |
| **StrayLightAugmenter** | nirs4all | advanced | `stray_light_fraction`=0.001, `edge_enhancement`=2, `edge_width`=0.1, `include_peak_truncation`=true, `variation_scope` (sample/batch) | `stray_light_fraction` [0.0001-0.01] | - |
| **EdgeCurvatureAugmenter** | nirs4all | advanced | `curvature_strength`=0.02, `curvature_type` (random/smile/frown/asymmetric), `asymmetry`=0, `edge_focus`=0.7, `variation_scope` (sample/batch) | `curvature_strength` [0.005-0.1] | - |
| **TruncatedPeakAugmenter** | nirs4all | advanced | `peak_probability`=0.3, `amplitude_range_min`=0.01, `amplitude_range_max`=0.1, `width_range_min`=50, `width_range_max`=200, `left_edge`=true, `right_edge`=true, `variation_scope` (sample/batch) | `peak_probability` [0.1-0.7] | - |
| **EdgeArtifactsAugmenter** | nirs4all | advanced | `detector_roll_off`=true, `stray_light`=true, `edge_curvature`=true, `truncated_peaks`=true, `overall_strength`=1, `detector_model` (generic_nir/ingaas_standard/ingaas_extended/pbs/silicon_ccd), `variation_scope` (sample/batch) | `overall_strength` [0.1-2] | - |

### Synthesis

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **PathLengthAugmenter** | nirs4all | standard | `path_length_std`=0.05, `min_path_length`=0.5, `variation_scope` (sample/batch) | - | - |
| **BatchEffectAugmenter** | nirs4all | standard | `offset_std`=0.02, `slope_std`=0.01, `gain_std`=0.03, `variation_scope` (sample/batch) | - | - |
| **InstrumentalBroadeningAugmenter** | nirs4all | standard | `fwhm`=3, `variation_scope` (sample/batch) | - | - |
| **DeadBandAugmenter** | nirs4all | advanced | `n_bands`=1, `width_range_min`=10, `width_range_max`=30, `noise_std`=0.05, `probability`=1, `variation_scope` (sample/batch) | - | - |

### Spline

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Spline_Smoothing** | nirs4all | standard | `variation_scope` (sample/batch) | - | - |
| **Spline_X_Perturbations** | nirs4all | standard | `spline_degree`=3, `perturbation_density`=0.05, `perturbation_range_min`=-10, `perturbation_range_max`=10, `variation_scope` (sample/batch) | - | - |
| **Spline_Y_Perturbations** | nirs4all | standard | `spline_points`, `perturbation_intensity`=0.005, `variation_scope` (sample/batch) | - | - |
| **Spline_X_Simplification** | nirs4all | standard | `spline_points`, `uniform`=false, `variation_scope` (sample/batch) | - | - |
| **Spline_Curve_Simplification** | nirs4all | standard | `spline_points`, `uniform`=false, `variation_scope` (sample/batch) | - | - |

### Random

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Random_X_Operation** | nirs4all | standard | `operator_range_min`=0.97, `operator_range_max`=1.03, `variation_scope` (sample/batch) | - | - |
| **Rotate_Translate** | nirs4all | standard | `p_range`=2, `y_factor`=3, `variation_scope` (sample/batch) | - | - |

---

## Y-Processing

### Scaling

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **StandardScaler** | sklearn | core | `with_mean`=true, `with_std`=true | - | - |
| **MinMaxScaler** | sklearn | core | `feature_range`=(0, 1) | - | - |
| **RobustScaler** | sklearn | standard | `with_centering`=true, `with_scaling`=true | - | - |
| **IntegerKBinsDiscretizer** | nirs4all | standard | `n_bins`=5, `strategy` (mean/median/most_frequent/constant/uniform/quantile/kmeans) | `n_bins` [2-20] | - |
| **RangeDiscretizer** | nirs4all | standard | - | - | - |
| **MaxAbsScaler** | sklearn | standard | - | - | - |
| **Normalizer** | sklearn | advanced | `norm` (l1/l2/max) | - | - |
| **LogTransform** | nirs4all | standard | - | - | - |
| **Binarizer** | sklearn | standard | `threshold`=0 | `threshold` [-10-10] | - |
| **FunctionTransformer** | sklearn | advanced | - | - | - |

### Transform

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **PowerTransformer** | sklearn | standard | `method` (yeo-johnson/box-cox) | - | - |
| **QuantileTransformer** | sklearn | standard | `output_distribution` (uniform/normal), `n_quantiles`=1000 | - | - |

---

## Filters

### Outlier

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **YOutlierFilter** | nirs4all | core | `filter_mode` (remove/tag), `method` (iqr/zscore/percentile/mad), `threshold`=1.5, `lower_percentile`=1, `upper_percentile`=99 | - | - |
| **XOutlierFilter** | nirs4all | core | `filter_mode` (remove/tag), `method` (mahalanobis/robust_mahalanobis/pca_residual/pca_leverage/isolation_forest/lof), `contamination`=0.1 | - | - |
| **HighLeverageFilter** | nirs4all | standard | `filter_mode` (remove/tag), `method` (hat/pca), `threshold_multiplier`=2 | - | - |

### Quality

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **SpectralQualityFilter** | nirs4all | standard | `filter_mode` (remove/tag), `max_nan_ratio`=0.1, `max_zero_ratio`=0.5, `min_variance`=1e-8, `check_inf`=true | - | - |

### Selection

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **MetadataFilter** | nirs4all | standard | `filter_mode` (remove/tag), `column`=, `values_to_exclude`, `values_to_keep`, `exclude_missing`=true | - | - |

---

## Flow Control

### Branching

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **ParallelBranch** | nirs4all | core | - | - | - |

### Multi-Source

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **SourceBranch** | nirs4all | standard | `sources`=NIR,markers | - | - |

### Merge

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **MergePredictions** | nirs4all | core | `mode` (predictions/features/average) | - | - |
| **MergeSources** | nirs4all | standard | `axis` (features/samples) | - | - |

### Containers

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **SampleAugmentation** | nirs4all | core | - | - | - |
| **FeatureAugmentation** | nirs4all | standard | - | - | - |
| **SampleFilterContainer** | nirs4all | core | - | - | - |
| **ConcatTransform** | nirs4all | standard | `keep_original`=true | - | - |

### Selection

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Or** | nirs4all | core | `pick`, `arrange`, `count` | - | - |
| **Chain** | nirs4all | standard | `count` | - | - |

### Combination

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Cartesian** | nirs4all | core | `pick`, `arrange`, `count` | - | - |

### Parameters

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Grid** | nirs4all | standard | `count` | - | - |
| **Zip** | nirs4all | standard | `count` | - | - |
| **Sample** | nirs4all | standard | `distribution` (uniform/log_uniform/normal/choice), `from`=0, `to`=1, `mean`=0, `std`=1, `num`=10, `count` | - | - |
| **Range** | nirs4all | core | `from`=1, `to`=10, `step`=1, `count` | - | - |
| **LogRange** | nirs4all | core | `from`=0.001, `to`=1, `num`=10, `count` | - | - |

---

## Utilities

### Visualization

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Chart** | nirs4all | standard | `chart_type` (spectra/scatter/pca/loadings/histogram), `title`= | - | - |

### Documentation

| Node | Source | Tier | Key Parameters | Finetuning | Sweeps |
|------|--------|------|---------------|------------|--------|
| **Comment** | editor | standard | `text`=Add your comment here... | - | - |

---

*Generated on 2026-04-16*
