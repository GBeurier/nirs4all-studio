# Interface Tour

This page gives you a guided tour of the nirs4all Studio interface. Understanding the layout will help you navigate the application efficiently as you work through your analysis tasks.

```{figure} /_images/getting-started/gs-interface-overview.png
:alt: nirs4all Studio interface overview
:width: 100%

The main interface of nirs4all Studio, showing the sidebar, header, and content area.
```

The interface is divided into three main areas: the **sidebar** on the left, the **header** at the top, and the **main content area** in the center.

## Sidebar

The sidebar is your primary navigation tool. It is organized into three groups of pages, each covering a different stage of the analysis workflow.

```{figure} /_images/getting-started/gs-sidebar.png
:alt: Sidebar navigation
:width: 250px

The sidebar with its three navigation groups and Settings at the bottom.
```

### Prepare

These pages help you set up your data and analysis configuration:

| Page | What it does |
|---|---|
| **Datasets** | Import, browse, and manage your spectral datasets |
| **Pipelines** | View and organize your saved pipelines |
| **Pipeline Editor** | Build and edit analysis pipelines visually with drag-and-drop |
| **Run** | Configure and launch experiments (the experiment wizard) |

### Explore

These pages let you interact with your data and results in hands-on ways:

| Page | What it does |
|---|---|
| **Playground** | Visualize spectra, apply preprocessing live, and compare transformations side by side |
| **Inspector** | Analyze model predictions in detail with interactive charts and grouping tools |
| **Lab** | Access advanced tools: synthetic data generation, transfer learning analysis, and variable importance (SHAP) |

### Results

These pages let you review what happened after running experiments:

| Page | What it does |
|---|---|
| **History** | View a log of all experiment runs, their status, and duration |
| **Results** | Explore scores, metrics, and detailed performance for each pipeline chain |
| **Predictions** | Manage and export prediction files from your trained models |

### Settings

At the bottom of the sidebar, the **Settings** link opens the application configuration page where you can manage workspaces, change the theme, set language preferences, and adjust data loading defaults.

:::{tip}
You can **collapse the sidebar** to give yourself more screen space. Click the small arrow button on the right edge of the sidebar to toggle between expanded and collapsed modes. In collapsed mode, the sidebar shows only icons, and hovering over an icon reveals the page name in a tooltip.
:::

## Header

The header bar runs along the top of the screen and contains three elements:

```{figure} /_images/getting-started/gs-header.png
:alt: Header bar
:width: 100%

The header bar with breadcrumbs, search, and theme toggle.
```

### Breadcrumbs

On the left side of the header, **breadcrumbs** show your current location within the application. For example, if you are viewing a specific dataset, the breadcrumbs might read **Datasets > Corn Dataset**. Clicking on a breadcrumb navigates you back to that level.

### Search Bar

In the center-right area, the **search bar** lets you quickly jump to any page. Start typing a page name or keyword (like "playground" or "import") and matching pages will appear in a dropdown. Select one to navigate there immediately.

:::{tip}
Press {kbd}`Ctrl+K` (or {kbd}`Cmd+K` on macOS) to focus the search bar from anywhere in the application. This is the fastest way to navigate between pages.
:::

### Theme Toggle

On the far right, the **theme toggle** button lets you switch between **Light**, **Dark**, and **System** (follows your operating system setting) themes. Click the sun/moon icon to open the theme menu.

## Main Content Area

The large central area of the screen is where each page displays its content. When you select a page from the sidebar, its content appears here. This is where you will do most of your work: viewing datasets, building pipelines, configuring experiments, and exploring results.

The content area adapts to each page. Some pages (like the Pipeline Editor) fill the entire space with an interactive canvas, while others (like Results) show tables, charts, and summary cards.

## Floating Run Widget

When an experiment is running, a **floating widget** appears in the bottom-right corner of the screen. This small panel shows you the progress of active runs without leaving your current page.

```{figure} /_images/getting-started/gs-floating-widget.png
:alt: Floating run progress widget
:width: 300px

The floating run widget showing progress for an active experiment.
```

The widget displays:

- The **name** of the running experiment
- A **progress bar** with percentage
- **Recent log messages** from the run
- A **View Details** button to open the full Run Progress page

You can **minimize** the widget to a small icon if you want it out of the way. When minimized, it shows a spinning indicator with a badge for the number of active runs. Click it to expand again.

:::{note}
The floating widget automatically hides when you navigate to the Run Progress page, since that page already shows the full progress details.
:::

## Next Steps

Now that you know your way around the interface, head to the {doc}`quickstart` to import your first dataset and run an experiment in just a few minutes.
