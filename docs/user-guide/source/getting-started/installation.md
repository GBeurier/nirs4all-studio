# Installation

This page explains how to install nirs4all Studio on your computer. The application runs on Windows, macOS, and Linux, either as a standalone desktop app or in web mode for advanced users.

## System Requirements

Before installing, make sure your computer meets the following minimum requirements:

| Requirement | Minimum | Recommended |
|---|---|---|
| **Operating System** | Windows 10, macOS 10.15 (Catalina), Ubuntu 20.04 | Windows 11, macOS 13+, Ubuntu 22.04+ |
| **RAM** | 4 GB | 8 GB or more |
| **Disk Space** | 500 MB for the application | 2 GB+ (depending on your datasets) |
| **Display** | 1280 x 720 | 1920 x 1080 or higher |

:::{note}
Larger datasets and complex pipelines (especially those using deep learning models) benefit from 16 GB of RAM or more.
:::

## Desktop App (Recommended)

The easiest way to get started is to download the desktop application from the GitHub releases page. The installer bundles everything you need -- no additional software required.

### Windows

1. Go to the [nirs4all Studio releases page](https://github.com/nirs4all/nirs4all-webapp/releases) on GitHub.
2. Download the latest `.exe` installer (for example, `nirs4all-studio-setup-1.0.0.exe`).
3. Run the installer and follow the on-screen instructions.
4. Once installed, launch **nirs4all Studio** from your Start menu or desktop shortcut.

### macOS

1. Go to the [nirs4all Studio releases page](https://github.com/nirs4all/nirs4all-webapp/releases) on GitHub.
2. Download the latest `.dmg` file (for example, `nirs4all-studio-1.0.0.dmg`).
3. Open the `.dmg` file and drag **nirs4all Studio** into your Applications folder.
4. Launch the app from your Applications folder or Launchpad.

:::{tip}
If macOS shows a warning that the app is from an unidentified developer, right-click the app icon, select **Open**, and then click **Open** in the confirmation dialog. You only need to do this once.
:::

### Linux

Two package formats are available:

- **AppImage** (works on most distributions): Download the `.AppImage` file, make it executable (`chmod +x nirs4all-studio-*.AppImage`), and run it directly.
- **Debian package** (Ubuntu, Debian, Mint): Download the `.deb` file and install it with `sudo dpkg -i nirs4all-studio-*.deb`.

## Web Mode (Advanced)

If you prefer to run nirs4all Studio as a local web application in your browser, you can set it up manually. This requires some familiarity with the command line.

### Prerequisites

- **Node.js** version 20 or later ([download](https://nodejs.org/))
- **Python** version 3.11 or later ([download](https://www.python.org/downloads/))
- **Git** (to clone the repository)

### Setup Steps

1. **Clone the repository**:

   ```bash
   git clone https://github.com/nirs4all/nirs4all-webapp.git
   cd nirs4all-webapp
   ```

2. **Install frontend dependencies**:

   ```bash
   npm install
   ```

3. **Create a Python virtual environment and install backend dependencies**:

   ```bash
   python -m venv .venv
   ```

   Activate the virtual environment:
   - Windows: `.venv\Scripts\activate`
   - macOS / Linux: `source .venv/bin/activate`

   Then install the requirements:

   ```bash
   pip install -r requirements.txt
   ```

4. **Start the application**:

   ```bash
   npm start
   ```

   This launches both the frontend development server and the FastAPI backend. Open your browser to the URL shown in the terminal (usually `http://localhost:5173`).

:::{warning}
Web mode is intended for development and advanced use. For everyday analysis work, the desktop app provides a smoother experience with automatic backend management and native file dialogs.
:::

## GPU Support (Optional)

GPU acceleration is optional and only relevant if you plan to use deep learning models (TensorFlow, PyTorch, or JAX). Standard machine learning methods like PLS, Random Forest, and SVM run on the CPU and do not require a GPU.

| Platform | GPU Technology | Notes |
|---|---|---|
| Windows | NVIDIA CUDA | Requires an NVIDIA GPU and [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) |
| Linux | NVIDIA CUDA | Requires an NVIDIA GPU and CUDA drivers |
| macOS | Apple Metal | Supported natively on Apple Silicon (M1/M2/M3/M4) Macs |

:::{tip}
You can start using nirs4all Studio without GPU support and add it later if you need to train deep learning models. The application works perfectly well with CPU-only setups.
:::

## After Installation

Once the application is installed, launch it and you will see the initial screen.

```{figure} /_images/getting-started/gs-first-launch.png
:alt: nirs4all Studio first launch screen
:width: 80%

The nirs4all Studio welcome screen on first launch.
```

Head to {doc}`first-launch` to learn how to create your first workspace and get everything ready for analysis.
