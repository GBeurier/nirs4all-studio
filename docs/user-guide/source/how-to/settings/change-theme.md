# Change the Theme and Display Settings

This guide shows you how to customize the visual appearance of nirs4all Studio, including the color theme, layout density, zoom level, and animations.

## Prerequisites

- nirs4all Studio is running.

## Steps

1. **Open the Settings page.** Click **Settings** in the bottom section of the sidebar navigation.

   ```{figure} ../../_images/settings/st-general.png
   :alt: Settings page showing the General tab with Appearance options
   :width: 700px

   The General tab in Settings contains all appearance controls in the Appearance card.
   ```

2. **Choose a theme.** In the **Appearance** card, locate the **Theme** selector and pick one of the three options:

   - **Light** -- a bright interface with white backgrounds. Suitable for well-lit environments.
   - **Dark** -- a dark interface with muted tones. Reduces eye strain in low-light conditions.
   - **System** -- automatically follows your operating system's light/dark preference.

   The theme changes immediately when you select it.

   ```{figure} ../../_images/settings/st-dark-theme-preview.png
   :alt: nirs4all Studio in dark theme showing the teal accent colors
   :width: 700px

   The dark theme with teal/cyan accent colors applied throughout the interface.
   ```

3. **Adjust the display density.** The **Density** selector controls the spacing between interface elements:

   - **Compact** -- minimal padding and margins. Fits the most content on screen. Best for experienced users with large monitors.
   - **Comfortable** -- balanced spacing (the default). Works well for most users and screen sizes.
   - **Spacious** -- generous padding between elements. Easier to read and click, especially on touch screens.

   :::{tip}
   Try **Compact** density if you find yourself scrolling frequently. Try **Spacious** density if the interface feels cramped or if you are using a touch-enabled device.
   :::

4. **Set the zoom level.** The **Zoom** control adjusts the overall scale of the interface. Available levels are: **75%**, **80%**, **90%**, **100%** (default), **110%**, **125%**, and **150%**.

   - Lower values let you see more content at once.
   - Higher values make text and controls larger and easier to read.

   :::{note}
   Zoom and density are independent settings that work together. For example, you can use Compact density with 125% zoom to get tight spacing but larger text -- useful for high-resolution displays.
   :::

5. **Toggle animations.** The **Reduce Animations** switch lets you minimize transition effects throughout the application. When enabled, page transitions are instant, cards appear without fade effects, and charts render without entrance animations.

   This is useful if you prefer a snappier interface, are sensitive to motion, or are running on a lower-powered device.

---

## Where Are These Settings Saved?

Display settings are stored in your **app settings** (located in `~/.nirs4all-webapp/`), not in the workspace. This means your theme, density, zoom, and animation preferences follow you across all workspaces.

## What's Next

- {doc}`language` -- Change the interface language.
- {doc}`manage-workspaces` -- Learn how to manage workspace folders.
