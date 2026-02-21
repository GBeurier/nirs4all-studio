# Contributing to nirs4all-webapp

Thanks for your interest in contributing to the nirs4all webapp!

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies:
   ```bash
   npm install
   pip install -r requirements.txt   # or use the bundled venv
   ```
4. Start the development servers:
   ```bash
   npm start                          # web dev mode
   npm run start:desktop              # desktop dev mode (Electron)
   ```

## Development Guidelines

### Frontend (React + TypeScript)

- Target **TypeScript strict mode**
- Use **shadcn/ui** and **Radix** primitives for UI components
- Use **TanStack Query** for server state
- Path alias: `@` maps to `./src`
- Run `npm run lint` before submitting

### Backend (FastAPI + Python)

- Target **Python 3.11+**
- Follow **PEP 8** and **Google Style docstrings**
- The backend is a **thin orchestration layer** — scientific computation belongs in the `nirs4all` library, not here
- Run `pytest` before submitting

### Testing

- Frontend: `npm run test`
- Backend: `pytest`
- E2E: `npm run e2e`

### Architecture Boundary

**Do not** reimplement nirs4all library functionality in the webapp backend.
The backend should only handle HTTP routing, job queuing, WebSocket notifications, and UI state.

## Contribution Licensing (inbound = outbound)

By submitting a contribution, you agree it is provided under the **same dual license**
as the project (open-source AGPL/GPL/CeCILL + commercial option), with no extra restrictions.

If your organization requires a **CLA**, please see `../nirs4all/CLA.md` and sign as needed.
