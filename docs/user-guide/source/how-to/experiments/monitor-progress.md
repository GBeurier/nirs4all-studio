# Monitor Experiment Progress

This guide explains how to track a running experiment in real time using the Run Progress page and the floating run widget.

---

## Open the Run Progress page

When you launch an experiment, you are automatically redirected to the **Run Progress** page. If you navigated away, you can return in two ways:

- Click the **floating run widget** in the bottom-right corner of the screen. This widget appears on every page while an experiment is running.
- Click **Run** in the left sidebar and select the active experiment.

```{figure} /_images/how-to/experiments/exp-run-progress.png
:alt: Run Progress page overview
:width: 100%

The Run Progress page shows real-time status of the experiment.
```

---

## What you see on the Run Progress page

### Overall progress bar

At the top of the page, a progress bar shows how far along the experiment is as a percentage. The bar fills as pipeline variants and cross-validation folds complete.

### Current step name

Below the progress bar, the name of the currently executing pipeline step is displayed (for example, **SNV**, **KennardStone**, or **PLSRegression**). This updates as the experiment moves through each step.

### Fold progress

A fold counter shows which cross-validation fold is currently running. For example:

> Fold 3 / 5

This means the third out of five folds is being processed. Each fold trains the model on a different data split and evaluates it on the held-out portion.

### Variant progress

If your pipeline uses generators (parameter sweeps or alternatives), a variant counter shows which configuration is being evaluated. For example:

> Variant 12 / 48

This means 12 out of 48 total pipeline configurations have been processed so far.

### Live metrics

As each fold and variant completes, the computed metrics appear in the metrics panel. For regression tasks you will see RMSE and R2. For classification tasks you will see Accuracy. These values update in real time, letting you see early trends before the experiment finishes.

### Log panel

At the bottom of the page, a scrollable log panel shows detailed execution output. Expand this panel by clicking the log area or the expand icon. The log includes timestamps, step names, fold numbers, and any warnings or errors.

```{figure} /_images/how-to/experiments/exp-log-panel.png
:alt: Log panel showing execution details
:width: 100%

The log panel provides detailed execution output.
```

---

## The floating run widget

While an experiment is running, a small widget appears in the bottom-right corner of every page in the application. The widget shows:

- A mini progress bar.
- The experiment name.
- A quick-access link back to the Run Progress page.

This means you can continue working on other tasks (importing data, editing pipelines) without losing track of the running experiment. Click the widget at any time to jump back to the full Run Progress page.

:::{tip}
If you are running a long experiment, you do not need to keep the Run Progress page open. The experiment continues in the background, and you can return to check on it whenever you like.
:::

---

## See also

- {doc}`launch-experiment` -- How to start an experiment.
- {doc}`stop-experiment` -- How to cancel an experiment that is running.
- {doc}`review-logs` -- How to filter and search through execution logs.
