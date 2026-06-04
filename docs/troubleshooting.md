# Troubleshooting

## Backend does not start

Check:

1. Python environment is active.
2. Backend dependencies are installed.
3. Port `8000` is free, or set `NIRS4ALL_PORT`.
4. `python main.py --port 8000` works outside Electron.

Useful commands:

```bash
source .venv/bin/activate
python main.py --port 8000 --host 127.0.0.1
```

```bash
npm run status
npm run clean
```

## Frontend cannot reach the API

In web mode, Vite must be running on port `5173` and the backend must be on
`127.0.0.1:8000`. Vite proxies `/api` and `/ws`.

Direct health check:

```bash
curl http://127.0.0.1:8000/api/health
```

In Electron mode, open Settings and inspect backend status. The backend port is
dynamic and comes from Electron.

## nirs4all library unavailable

Install the library in the backend Python environment:

```bash
source .venv/bin/activate
pip install -e ../nirs4all
```

or:

```bash
pip install nirs4all
```

If the UI runs but scientific routes fail, this is usually the missing piece.

## Dataset appears missing

Check:

1. The source files still exist at the saved paths.
2. The app has permission to read the files.
3. The dataset configuration points to the right train/test files.
4. Refresh the dataset from the Datasets page.
5. If using a moved config folder, confirm `NIRS4ALL_CONFIG` or Settings path.

## Pipeline validation fails

Common causes:

- missing model step
- splitter placed after model steps
- invalid parameter type
- parameter outside allowed min/max range
- node not available in the current registry
- dataset binding missing for shape-dependent validation
- classification model used with regression targets, or the reverse

Bind a dataset, rerun validation, and inspect step-level messages.

## Electron window opens but backend stays unhealthy

Check main-process logs for the backend command and stderr. Common causes:

- `.venv` is missing or invalid
- bundled backend was not copied into `backend-dist/`
- PyInstaller build failed
- antivirus or permissions blocked the backend executable
- first launch is still importing Python dependencies

Build the backend again:

```bash
npm run build:backend:cpu
npm run electron:preview
```

## WSL2 npm uses Windows Node

If npm calls `cmd.exe` from WSL, disable Windows PATH injection and reinstall
Linux-native Node:

```bash
npm run setup:wsl
nvm use
```

Then from Windows:

```powershell
wsl.exe --shutdown
```

## Read the Docs build fails

Install the docs dependencies locally and build:

```bash
python -m pip install -r docs/requirements.txt
mkdocs build
```

Common causes:

- missing page listed in `mkdocs.yml`
- invalid YAML indentation
- unsupported MkDocs extension
- broken relative link
- package version conflict in `docs/requirements.txt`
