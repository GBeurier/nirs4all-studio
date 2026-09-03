# Troubleshooting

This guide helps you diagnose and resolve common issues in nirs4all Studio. Most problems can be identified and fixed using the built-in diagnostic tools on the Settings page.

## Prerequisites

- nirs4all Studio is running (or at least the frontend is accessible).

## Steps

### Check Backend Status

1. **Open the Settings page.** Click **Settings** in the sidebar navigation.

2. **Go to the Advanced tab.** Click the **Advanced** tab to access system diagnostics.

   ```{figure} ../../_images/settings/st-advanced.png
   :alt: Settings Advanced tab showing backend status, system info, and maintenance controls
   :width: 700px

   The Advanced tab displays backend status, system information, and maintenance actions.
   ```

3. **Check the backend status indicator.** A green indicator means the Rust control-plane sidecar is running and responsive. A red indicator means the sidecar is unreachable.

   - If the status is **green**, the control plane is healthy. Your issue may be related to the interface, the selected capability, or your data.
   - If the status is **red**, restart the sidecar lifecycle (see below).

### Restart the Backend

1. On the **Advanced** tab, click the **Restart Backend** button.

2. Wait a few seconds for the Rust sidecar to initialize. The status indicator should turn green.

:::{warning}
Restarting the backend will interrupt any running experiment. Make sure no experiment is in progress before restarting. If an experiment was interrupted, you can re-launch it from the Experiments page.
:::

### Review System Information

The **System Info** section on the Advanced tab displays key details about your environment:

- **Python version** -- the interpreter in the bounded stdio library/plugin host, when present; it is not the HTTP backend.
- **nirs4all version** -- the attested version in that read-only plugin closure, when present.
- **Operating system** -- your OS name and version.
- **GPU detection** -- informational hardware visibility for an explicitly packaged library/plugin capability.

:::{note}
GPU detection shows what the system can see, not what an operation may use.
Native Methods training uses the qualified CPU path; optional plugins must pass
their own capability preflight.
:::

### Clear Cache

1. On the **Advanced** tab, locate the **Clear Cache** button.

2. Click it to remove temporary files and cached computations. This can help if you are experiencing stale data, unexpected behavior, or disk space issues.

   Clearing the cache does not delete your datasets, models, or results. It only removes temporary files.

### Check for Updates

1. On the **Advanced** tab, click **Check for Updates**.

2. If an update is available, the app displays the new version number and a changelog summary. Follow the on-screen instructions to download and install the update.

:::{tip}
Keep nirs4all Studio up to date. Updates include bug fixes, new features, and improvements to the nirs4all library that may improve model performance or add new preprocessing options.
:::

---

## Common Issues and Solutions

### The application is slow or unresponsive

- **Close other memory-intensive applications.** Studio keeps spectral data and visualizations in its desktop renderer.
- **Reduce the dataset size** by filtering or sampling before running experiments.
- **Check the Advanced tab** for CPU and memory usage indicators.
- **Disable animations** in Settings > General > Appearance to reduce rendering overhead.

### Import wizard does not detect the correct format

- Verify the **delimiter** and **decimal separator** match your file. European instruments often use semicolons and commas where US instruments use commas and dots.
- Check that the file does not contain extra header rows or footer comments. Use the **Skip Rows** option in the Advanced Loading Options of the import wizard.
- Set correct defaults in {doc}`data-defaults` to avoid repeating this for every import.

### Experiment fails immediately after starting

- Check that the **Rust sidecar is running** (green status on the Advanced tab).
- Review the **execution logs** from the Runs page. The log usually contains an error message explaining what went wrong.
- Verify that the selected dataset is not empty and that target values are present.
- If using an optional library/plugin method, check its packaged capability and preflight. The embedded runtime cannot install a missing dependency.

### SHAP analysis takes too long or fails

- SHAP computation time depends heavily on model type and dataset size. Tree ensemble models with many estimators are slower.
- Try running SHAP on a **smaller subset** of your data to verify it works before scaling up.
- Ensure the scientific host has not run out of memory. Check system info and the operation log on the Advanced tab.

### GPU is not detected

- Verify that your GPU drivers are up to date.
- For NVIDIA GPUs, ensure CUDA is installed and that `nvidia-smi` returns valid output from a terminal.
- Check that the installed release explicitly packages the requested accelerated plugin capability.
- Restart Studio after installing or updating GPU drivers. Do not modify the embedded CPython closure.

:::{important}
If none of the above solutions resolve your issue, check the {doc}`/appendix/known-issues` page for documented bugs and workarounds, or consult the {doc}`/appendix/faq` for frequently asked questions.
:::

## What's Next

- {doc}`manage-workspaces` -- Re-link a workspace if it appears disconnected.
- {doc}`change-theme` -- Adjust display settings if the interface is hard to read.
