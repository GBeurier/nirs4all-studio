/**
 * File dialog utilities for native desktop integration
 * Supports Electron environment
 */

/**
 * Check if running in Electron environment
 */
export function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.electronApi?.isElectron;
}

/**
 * Check if running in desktop environment (Electron)
 */
export function isDesktop(): boolean {
  return isElectron();
}

/**
 * Open a native folder picker dialog
 * Falls back to a prompt in browser environment
 */
export async function selectFolder(): Promise<string | null> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.selectFolder();
  }
  // Browser fallback
  return prompt("Enter folder path:");
}

/**
 * Confirm a dropped folder by opening a folder dialog
 * Used when drag-drop doesn't provide the folder path (Electron limitation)
 * @param folderName - The name of the dropped folder
 */
export async function confirmDroppedFolder(folderName: string): Promise<string | null> {
  if (isElectron() && window.electronApi?.confirmDroppedFolder) {
    return await window.electronApi.confirmDroppedFolder(folderName);
  }
  // Browser fallback
  return prompt(`Enter path for folder "${folderName}":`);
}

/**
 * Open a native file picker dialog
 */
export async function selectFile(
  fileTypes?: string[],
  allowMultiple?: boolean
): Promise<string | string[] | null> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.selectFile(fileTypes, allowMultiple);
  }
  // Browser fallback
  const path = prompt("Enter file path:");
  return allowMultiple && path ? [path] : path;
}

/**
 * Open a native save file dialog
 */
export async function saveFile(
  defaultFilename?: string,
  fileTypes?: string[]
): Promise<string | null> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.saveFile(defaultFilename, fileTypes);
  }
  // Browser fallback
  return prompt("Enter save path:", defaultFilename);
}

/**
 * Open a file or folder in the system file explorer
 */
export async function revealInExplorer(filePath: string): Promise<void> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.revealInExplorer(filePath);
  }
  // No browser fallback
  console.warn("revealInExplorer is not available in browser mode");
}

/**
 * Open a URL in the system default browser
 */
export async function openExternal(url: string): Promise<void> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.openExternal(url);
  }
  // Browser fallback
  window.open(url, "_blank");
}

/**
 * Resize the desktop window
 * Only available in desktop mode (Electron)
 */
export async function resizeWindow(width: number, height: number): Promise<boolean> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.resizeWindow(width, height);
  }
  // Not available in browser
  return false;
}

/**
 * Minimize the desktop window
 * Only available in desktop mode
 */
export async function minimizeWindow(): Promise<boolean> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.minimizeWindow();
  }
  return false;
}

/**
 * Toggle maximize/restore the desktop window
 * Only available in desktop mode
 */
export async function maximizeWindow(): Promise<boolean> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.maximizeWindow();
  }
  return false;
}

/**
 * Restore the desktop window from minimized/maximized state
 * Only available in desktop mode
 */
export async function restoreWindow(): Promise<boolean> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.restoreWindow();
  }
  return false;
}

/**
 * Get current window size
 * Only available in desktop mode
 */
export async function getWindowSize(): Promise<{ width: number; height: number } | null> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.getWindowSize();
  }
  // Browser fallback - return viewport size
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}
