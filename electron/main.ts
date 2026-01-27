/* eslint-disable @typescript-eslint/no-require-imports */
// Use require for electron to avoid Rollup ESM/CJS interop issues
const electron = require("electron") as typeof import("electron");
const { app, BrowserWindow, ipcMain, dialog, shell } = electron;

import path from "node:path";
import { BackendManager } from "./backend-manager";

// WSL2/WSLg fixes - must be set before app is ready
if (process.platform === "linux" && process.env.WSL_DISTRO_NAME) {
  // Force X11 backend which has better cursor support in WSLg
  app.commandLine.appendSwitch("ozone-platform-hint", "x11");
}

const backendManager = new BackendManager();

let mainWindow: BrowserWindow | null = null;

// VITE_DEV_SERVER_URL is set by vite-plugin-electron in dev mode
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DIST_PATH = path.join(__dirname, "../dist");

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for file.path on dropped files
    },
    icon: path.join(__dirname, "../public/icon.png"),
    show: false, // Show after ready-to-show
  });

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Load the app
  if (VITE_DEV_SERVER_URL) {
    // Development mode: load from Vite dev server
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    // Production mode: load built files
    await mainWindow.loadFile(path.join(DIST_PATH, "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// IPC Handlers for file dialogs
ipcMain.handle("dialog:selectFolder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle(
  "dialog:confirmDroppedFolder",
  async (_, folderName: string) => {
    if (!mainWindow) return null;
    // Show folder selection dialog to confirm the dropped folder
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: `Select the folder "${folderName}" you just dropped`,
      message: `Please select the folder "${folderName}" to confirm its location`,
    });
    return result.canceled ? null : result.filePaths[0];
  }
);

ipcMain.handle(
  "dialog:selectFile",
  async (_, fileTypes?: string[], allowMultiple?: boolean) => {
    if (!mainWindow) return null;

    const filters =
      fileTypes && fileTypes.length > 0
        ? [
            {
              name: "Allowed Files",
              extensions: fileTypes.map((t) => t.replace(/^\./, "")),
            },
          ]
        : [];

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: allowMultiple
        ? ["openFile", "multiSelections"]
        : ["openFile"],
      filters,
    });

    if (result.canceled) return null;
    return allowMultiple ? result.filePaths : result.filePaths[0];
  }
);

ipcMain.handle(
  "dialog:saveFile",
  async (_, defaultFilename?: string, fileTypes?: string[]) => {
    if (!mainWindow) return null;

    const filters =
      fileTypes && fileTypes.length > 0
        ? [
            {
              name: "Save As",
              extensions: fileTypes.map((t) => t.replace(/^\./, "")),
            },
          ]
        : [];

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultFilename,
      filters,
    });

    return result.canceled ? null : result.filePath;
  }
);

// IPC Handlers for system operations
ipcMain.handle("system:revealInExplorer", async (_, filePath: string) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle("system:openExternal", async (_, url: string) => {
  await shell.openExternal(url);
});

// IPC Handlers for window management
ipcMain.handle("window:resize", (_, width: number, height: number) => {
  mainWindow?.setSize(width, height);
  return true;
});

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
  return true;
});

ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
  return true;
});

ipcMain.handle("window:restore", () => {
  mainWindow?.restore();
  return true;
});

ipcMain.handle("window:getSize", () => {
  if (!mainWindow) return null;
  const [width, height] = mainWindow.getSize();
  return { width, height };
});

// IPC Handlers for backend management
ipcMain.handle("backend:getPort", () => {
  return backendManager.getPort();
});

ipcMain.handle("backend:getUrl", () => {
  return backendManager.getUrl();
});

ipcMain.handle("backend:getInfo", () => {
  return backendManager.getInfo();
});

ipcMain.handle("backend:restart", async () => {
  try {
    const port = await backendManager.restart();
    return { success: true, port };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// App lifecycle
app.whenReady().then(async () => {
  // Start backend first
  try {
    const port = await backendManager.start();
    console.log(`Backend started on port ${port}`);
  } catch (error) {
    console.error("Failed to start backend:", error);

    // Show error dialog to user
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    const result = await dialog.showMessageBox({
      type: "error",
      title: "Backend Error",
      message: "Failed to start the backend server",
      detail: `${errorMessage}\n\nWould you like to continue without the backend? (limited functionality)`,
      buttons: ["Continue Anyway", "Quit"],
      defaultId: 1,
      cancelId: 1,
    });

    if (result.response === 1) {
      app.quit();
      return;
    }
  }

  // Create window regardless of backend status
  await createWindow();

  app.on("activate", () => {
    // macOS: re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Quit on all platforms except macOS
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  // Gracefully stop the backend
  await backendManager.stop();
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
