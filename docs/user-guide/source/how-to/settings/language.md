# Change the Interface Language

This guide shows you how to change the display language of nirs4all Studio. The application supports three languages: English, French, and German.

## Prerequisites

- nirs4all Studio is running.

## Steps

1. **Open the Settings page.** Click **Settings** in the bottom section of the sidebar navigation.

   ```{figure} ../../_images/settings/st-general.png
   :alt: Settings page showing the General tab with language selector in the Appearance card
   :width: 700px

   The General tab in Settings. The language selector is located in the Appearance card.
   ```

2. **Locate the language selector.** In the **Appearance** card on the General tab, find the **Language** dropdown.

3. **Select your language.** Choose one of the available options:

   - **English** -- the default language.
   - **French** (Francais) -- full French translation of the interface.
   - **German** (Deutsch) -- full German translation of the interface.

4. **Verify the change.** The language switch takes effect **immediately**. All menus, labels, buttons, tooltips, and interface text update to the selected language without requiring a restart.

:::{note}
The language setting affects the application interface only. Your data (dataset names, column headers, pipeline step names, log messages) remains in its original language. Scientific terms and model names (e.g., "PLS Regression", "SNV", "SHAP") are not translated.
:::

---

## Where Is the Language Setting Stored?

The language preference is saved in your **app settings** (located in `~/.nirs4all-webapp/`). It applies across all workspaces and persists between sessions. If you uninstall and reinstall the application, you may need to set the language again.

:::{tip}
If a colleague is using the same computer with a different language preference, each user's operating system profile maintains its own app settings directory. The language choice does not affect other users.
:::

## What's Next

- {doc}`change-theme` -- Customize the theme, density, and zoom level.
- {doc}`data-defaults` -- Set default values for the dataset import wizard.
