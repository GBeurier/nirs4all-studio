# Organize Datasets into Groups

As your workspace grows, managing many datasets becomes easier when you organize them into groups. Groups are visual folders on the Datasets page that help you categorize datasets by project, instrument, time period, or any other criteria.

## Prerequisites

- A workspace is open in nirs4all Studio.
- You have at least two datasets imported (see {doc}`import-csv` or {doc}`import-folder`).

## Steps

### Create a new group

1. **Open the Datasets page.** Click **Datasets** in the sidebar navigation.

2. **Create a group.** Click the **New Group** button (the folder icon with a plus sign) in the toolbar above the dataset list.

3. **Name the group.** A dialog appears asking for a group name. Enter a descriptive name, such as `Corn Project 2024` or `Instrument A`. Click **Create**.

4. The new group appears on the Datasets page as a collapsible section with the name you provided. It starts empty.

   ```{figure} /_images/how-to/datasets/group-created.png
   :alt: A newly created empty dataset group
   :width: 90%
   :class: screenshot

   A new group appears as a collapsible section on the Datasets page.
   ```

### Add datasets to a group

5. **Drag and drop.** Click and hold a dataset card, then drag it onto the group header. A highlight indicator appears when you hover over a valid drop target. Release to add the dataset to the group.

6. **Repeat** for each dataset you want to add to the group.

   :::{tip}
   You can select multiple datasets at once by holding **Ctrl** (or **Cmd** on macOS) and clicking each dataset. Then drag the entire selection onto a group.
   :::

7. Alternatively, **right-click** a dataset and select **Move to Group** from the context menu. A list of available groups appears. Click the target group.

### Rename a group

8. **Right-click** on the group header and select **Rename**. Edit the name in the inline text field and press **Enter** to confirm.

### Move a dataset out of a group

9. **Drag** the dataset out of the group area and drop it onto the main (ungrouped) area of the Datasets page.

10. Alternatively, right-click the dataset inside a group and select **Move to Group** > **None** to move it back to the ungrouped section.

### Collapse and expand groups

11. Click the **chevron arrow** on the group header to collapse or expand the group. Collapsed groups show only the header and a badge with the number of datasets inside.

### Delete a group

12. **Right-click** on the group header and select **Delete Group**.

13. A confirmation dialog appears. Choose one of the options:
    - **Delete group only** -- removes the group but keeps all datasets (they move to the ungrouped section).
    - **Cancel** -- keeps the group and its contents.

:::{important}
Deleting a group never deletes the datasets inside it. Datasets are always preserved. Only the organizational grouping is removed.
:::

## Tips for Organizing Datasets

| Strategy | Example group names |
|---|---|
| **By project** | `Corn Moisture`, `Wheat Protein`, `Olive Oil` |
| **By instrument** | `FOSS 6500`, `Bruker MPA`, `Ocean Insight` |
| **By time period** | `2024 Q1`, `2024 Q2`, `Archive` |
| **By purpose** | `Calibration`, `Validation`, `Transfer` |
| **By status** | `To Review`, `Ready`, `Completed` |

:::{note}
Groups are stored in your workspace metadata. They are specific to the active workspace and do not affect the underlying dataset files.
:::

## What's Next

- {doc}`inspect-data` -- explore individual datasets within a group.
- {doc}`batch-scan` -- import many datasets at once and then organize them into groups.
