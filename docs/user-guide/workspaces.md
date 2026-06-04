# Workspaces

A workspace is the directory that contains nirs4all analysis state. nirs4all
Studio can link several workspaces, but only one workspace is active at a time.

## App state versus workspace state

Two locations matter:

| Location | Owner | Contains |
| --- | --- | --- |
| App config folder | nirs4all Studio | linked workspace list, active workspace, UI settings, dataset links, favorites |
| nirs4all workspace | nirs4all library | runs, artifacts, prediction arrays, exports, templates, library-owned storage |

The default app config folder is:

- Linux and macOS: `~/.nirs4all/`
- Windows: `%APPDATA%\nirs4all\`

You can override it with `NIRS4ALL_CONFIG` or from the Settings page.

## Create or link a workspace

Open **Settings**, then use the workspace section to:

- create a new workspace directory
- link an existing workspace
- activate a linked workspace
- scan a workspace for runs, results, predictions, exports, and templates
- remove a workspace link from the app

Removing a workspace link does not delete the workspace directory.

## Active workspace behavior

At backend startup, the active workspace is restored from app settings. If the
`nirs4all` library is available, Studio calls `nirs4all.workspace.set_active_workspace`.
If the library is unavailable, Studio records the path in `NIRS4ALL_WORKSPACE`
so dependent code has a consistent fallback.

## Portable configuration

In packaged or portable deployments, Studio can use a `.nirs4all` folder next to
the executable. This is useful for lab machines where the application and its
settings should travel together.

## Common checks

If a workspace looks empty:

1. Confirm that the expected workspace is active in Settings.
2. Run a workspace scan from Settings.
3. Check that the workspace directory contains library output such as
   `store.sqlite`, `runs/`, `arrays/`, `artifacts/`, or `exports/`.
4. If using a custom config path, verify the value shown by Settings.
