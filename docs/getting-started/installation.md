# Install and run

This page covers the local developer install path. Packaged desktop releases are
built through the release process documented in
[Packaging and Releases](../development/releasing.md).

## Requirements

Use the versions below unless a release note for the project says otherwise.

| Tool | Version |
| --- | --- |
| Node.js | 22 recommended, 20 minimum |
| npm | 10 or newer |
| Python | 3.11 or newer |
| Git | Any current version |

The repository includes `.nvmrc`, so Node can be selected with:

```bash
nvm use
```

## Clone and install

```bash
git clone https://github.com/GBeurier/nirs4all-studio.git
cd nirs4all-studio
npm install
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-cpu.txt
```

On Windows PowerShell, activate the Python environment with:

```powershell
.\.venv\Scripts\Activate.ps1
```

For full analysis features, install the sibling `nirs4all` library or the
published package in the same Python environment:

```bash
pip install -e ../nirs4all
# or
pip install nirs4all
```

The UI can still run without `nirs4all` installed, but routes that need
scientific functionality will report that the library is unavailable.

## Start the application

Use the launcher scripts through npm when you want the frontend and backend
managed together:

```bash
npm run start:web
```

This starts Vite on `http://localhost:5173` and FastAPI on
`http://127.0.0.1:8000`. Vite proxies `/api` and `/ws` to the backend.

For desktop mode:

```bash
npm run start:desktop
```

Useful launcher commands:

```bash
npm run status
npm run stop
npm run restart
npm run clean
```

## Run pieces manually

Manual mode is useful when debugging a single process.

```bash
npm run dev
```

```bash
source .venv/bin/activate
npm run dev:api
```

```bash
npm run dev:electron
```

The backend default port is `8000`. Override it with `NIRS4ALL_PORT` or
`python main.py --port <port>`.

## WSL2 notes

Use Linux-native Node and npm inside WSL2. If Windows paths leak into WSL and
npm calls `cmd.exe`, run:

```bash
npm run setup:wsl
nvm use
```

Then restart WSL from Windows:

```powershell
wsl.exe --shutdown
```

## Build preview

Build the web application:

```bash
npm run build
```

Build and preview the Electron application:

```bash
npm run electron:preview
```

Build the Python backend binary:

```bash
npm run build:backend:cpu
```
