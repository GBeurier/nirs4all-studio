# nirs4all Webapp

**Unified NIRS Analysis Desktop Application**

A modern desktop application for Near-Infrared Spectroscopy (NIRS) data analysis, combining the power of the nirs4all Python library with a sleek React-based user interface.

## Features

- 📊 **Spectral Data Visualization** - Interactive charts for exploring NIRS spectra
- 🔬 **Pipeline Builder** - Visual drag-and-drop pipeline construction
- 🎯 **Prediction Engine** - Run trained models on new samples
- 📁 **Workspace Management** - Organize datasets, pipelines, and results
- 🖥️ **Native Desktop Experience** - Runs as a standalone desktop app

## Tech Stack

### Frontend
- **React 19** with TypeScript (strict mode)
- **Vite** for fast development and optimized builds
- **Tailwind CSS** with custom scientific design system
- **shadcn/ui** component library
- **TanStack Query** for API state management
- **Framer Motion** for smooth animations

### Backend
- **FastAPI** for high-performance REST API
- **nirs4all** Python library for NIRS analysis
- **PyWebView** for native desktop window

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- nirs4all library (optional for UI development)

### Development Setup

1. **Install Node dependencies:**
   ```bash
   npm install
   ```

2. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Start development servers:**

   Terminal 1 - Frontend (Vite):
   ```bash
   npm run dev
   ```

   Terminal 2 - Backend (FastAPI):
   ```bash
   python -m uvicorn main:app --reload --port 8000
   ```

4. **Open in browser:**
   Navigate to http://localhost:5173

### Desktop Mode

To run as a desktop application:

```bash
# Development mode (with hot reload)
VITE_DEV=true python launcher.py

# Production mode
python launcher.py
```

## Project Structure

```
nirs4all_webapp/
├── src/                    # React frontend source
│   ├── components/         # UI components
│   │   ├── layout/         # App layout (sidebar, header)
│   │   └── ui/             # shadcn/ui components
│   ├── context/            # React context providers
│   ├── lib/                # Utilities and helpers
│   ├── api/                # API client
│   └── pages/              # Route components
├── api/                    # FastAPI backend
│   ├── workspace.py        # Workspace management routes
│   ├── datasets.py         # Dataset operations
│   ├── pipelines.py        # Pipeline CRUD
│   ├── predictions.py      # Prediction storage
│   └── system.py           # Health and system info
├── public/                 # Static assets
├── main.py                 # FastAPI application entry
├── launcher.py             # PyWebView desktop launcher
└── package.json            # Node dependencies
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |

## Design System

The application uses a teal/cyan scientific theme inspired by spectral-explorer, featuring:

- **Glass morphism** cards with backdrop blur
- **Glow effects** for interactive elements
- **Dark/Light mode** with smooth transitions
- **Inter + JetBrains Mono** typography

## License

See the nirs4all project for license information.
