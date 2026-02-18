# Glossary

This glossary defines common terms used throughout nirs4all Studio and in the field of Near-Infrared Spectroscopy.

Absorbance
: A measure of how much light a sample absorbs at each wavelength. In NIRS, absorbance is calculated from reflectance using the Beer-Lambert law: A = -log10(R). Most analysis pipelines work with absorbance data.

Augmentation
: A technique that creates additional training samples by applying small, realistic modifications to existing spectra. This helps models generalize better, especially when datasets are small. Common augmentations include adding noise, shifting baselines, and simulating scattering effects.

Branch
: A pipeline structure that splits processing into two or more parallel paths. Each branch can apply different preprocessing or use different models. Branches are useful for comparing approaches or building ensemble models. See also {term}`Merge` and {term}`Stacking`.

Chain
: A specific combination of steps that forms a complete analysis path through a pipeline. When a pipeline contains generators or branches, it produces multiple chains -- each representing one unique sequence from preprocessing through model training. Results are reported per chain.

Classification
: A type of prediction task where the goal is to assign samples to discrete categories (for example, identifying a material type or quality grade). Compare with {term}`Regression`.

Cross-validation
: A method for evaluating how well a model will perform on new data. The dataset is split into several parts called folds. The model is trained on some folds and tested on the remaining fold, repeating until every fold has been used for testing. This gives a more reliable estimate of performance than a single train/test split.

Dataset
: A collection of spectral measurements and their associated target values. In nirs4all Studio, a dataset is imported from a file and contains spectra (the measurements), targets (what you want to predict), and optionally metadata (extra information about each sample).

DuckDB
: The embedded database engine used by nirs4all to store workspace data. DuckDB runs locally within the application -- no separate database server is needed. Your workspace database file is named `store.duckdb`.

Experiment
: A complete analysis session that pairs one or more datasets with a pipeline and runs the analysis. When you launch an experiment, nirs4all executes every chain in your pipeline against the selected datasets and records the results.

Feature
: A single measurement value at a specific wavelength within a spectrum. A spectrum with 1000 wavelengths has 1000 features. Feature selection methods choose the most informative wavelengths for building a model.

Feature selection
: The process of identifying which wavelengths (features) are most useful for prediction. Reducing the number of features can improve model accuracy and speed. Methods include CARS, VIP, MCUVE, and others.

Fold
: One subset of data in a cross-validation scheme. For example, in 5-fold cross-validation, the data is divided into 5 folds. Each fold takes a turn as the test set while the other 4 are used for training.

Generator
: A pipeline element that automatically creates multiple variants of a pipeline. Generators let you explore different configurations without manually building each one. Types include ChooseOne (`_or_`), Range (`_range_`), and Cartesian (`_cartesian_`).

KennardStone
: A sample selection algorithm that picks representative samples by maximizing the distance between selected points. It is widely used in NIRS to create well-distributed calibration and validation sets.

Merge
: A pipeline step that recombines the outputs from parallel branches. Merge modes include combining predictions (for stacking), concatenating features, or averaging predictions.

Metadata
: Extra information about each sample beyond the spectrum and target value. Examples include sample origin, collection date, instrument ID, or batch number. Metadata can be used for filtering, grouping, or splitting data.

Model
: A mathematical algorithm trained on data to make predictions. In nirs4all Studio, models include PLS Regression, Random Forest, SVR, neural networks, and many others. A model learns relationships between spectra and target values during training.

MSC (Multiplicative Scatter Correction)
: A preprocessing method that corrects for scattering effects in spectra. Each spectrum is regressed against a reference spectrum (usually the mean of all spectra) to remove multiplicative and additive scatter variations.

Near-Infrared Spectroscopy (NIRS)
: An analytical technique that measures how materials absorb or reflect light in the near-infrared region (roughly 780 to 2500 nm). It is widely used in agriculture, food science, pharmaceuticals, and chemistry for rapid, non-destructive analysis of sample composition.

NIR spectrum
: A single measurement recording how a sample interacts with near-infrared light across a range of wavelengths. Each spectrum is represented as a series of numerical values, one per wavelength.

Pipeline
: An ordered sequence of processing steps that defines a complete analysis workflow. A typical pipeline includes preprocessing (data cleaning), a splitter (cross-validation), and a model. Pipelines can also include branches, generators, and filters for advanced workflows.

PLS (Partial Least Squares)
: A regression method that finds latent variables (components) to maximize the covariance between spectra and target values. PLS Regression is the gold standard model for NIRS calibration. The main parameter is the number of components.

Prediction
: The output produced when a trained model is applied to new spectral data. Predictions estimate the target values for samples that were not used during training. In nirs4all Studio, you can export and manage predictions on the Predictions page.

Preprocessing
: The transformation of raw spectral data before model training. Preprocessing corrects for physical effects (scattering, baseline drift) and enhances the chemical information in spectra. Common methods include SNV, MSC, Savitzky-Golay derivatives, and baseline correction.

Reflectance
: The proportion of light reflected by a sample at each wavelength. Raw NIRS measurements are often recorded as reflectance and then converted to absorbance for analysis.

Regression
: A type of prediction task where the goal is to estimate a continuous numerical value (for example, protein content or moisture percentage). Compare with {term}`Classification`.

Refit
: The process of retraining the best model configuration on the full dataset (without cross-validation splits) to produce a final model for deployment. After cross-validation identifies the best pipeline, refitting creates the most accurate possible model.

RMSE
: Root Mean Square Error. A metric that measures how far predictions deviate from actual values, in the same units as the target. Lower RMSE means better accuracy. Calculated as the square root of the mean of squared differences between predicted and actual values.

R-squared (R2)
: A metric that indicates how well predictions match actual values, on a scale from 0 to 1. An R2 of 1.0 means perfect prediction. Also called the coefficient of determination. Higher values indicate better model performance.

Run
: A single execution of an experiment. Each run records which pipeline and datasets were used, along with all results, metrics, and trained models. Runs are stored in the workspace and can be reviewed in the History page.

Savitzky-Golay filter
: A preprocessing method that smooths spectra or computes derivatives by fitting successive sub-sets of data with a polynomial. It preserves spectral shape while reducing noise. Key parameters are the window length and polynomial order.

SHAP
: SHapley Additive exPlanations. A method for explaining model predictions by calculating how much each wavelength contributes to a particular prediction. SHAP values help you understand which spectral regions are most important for your model.

SNV (Standard Normal Variate)
: A preprocessing method that normalizes each spectrum individually to have zero mean and unit variance. It corrects for scatter effects caused by differences in sample particle size or path length.

Spectrometer
: The instrument used to measure NIR spectra. Different spectrometers may have different wavelength ranges, resolutions, and measurement modes (reflectance, transmittance, or transflectance).

SPXY
: Sample Partitioning based on joint X and Y distances. An extension of the Kennard-Stone algorithm that considers both the spectral data (X) and target values (Y) when selecting samples for calibration and validation sets.

Stacking
: An ensemble technique where the predictions from multiple models are combined by feeding them into a secondary (meta) model. In nirs4all Studio, stacking is achieved by creating parallel branches with different models, merging their predictions, and adding a final model step.

Target
: The property you want to predict from spectral data. In regression, this is a continuous value (such as protein content). In classification, this is a category label (such as material type). Also called the dependent variable or response variable.

Transfer analysis
: A method for comparing datasets to assess whether a model trained on one dataset will perform well on another. Transfer analysis examines how similar the spectral distributions are between two datasets, which is important when moving models between instruments or sample populations.

Variant
: One specific configuration generated by a pipeline generator. For example, if a generator creates variants with SNV, MSC, and Detrend preprocessing, each of those is a variant. The system evaluates all variants and reports which performs best.

Wavelength
: A specific position in the electromagnetic spectrum where a measurement is taken, expressed in nanometers (nm). Each wavelength in a NIR spectrum corresponds to one feature. The wavelength range determines which chemical bonds and properties can be detected.

Workspace
: A folder on your computer that stores all data for a set of related analyses. A workspace contains a DuckDB database, trained model artifacts, and exported files. You can create multiple workspaces to keep different projects separate. See {doc}`workspace-concept` for details.
