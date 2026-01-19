/**
 * File dialog utilities for native desktop integration
 * Supports both Electron and PyWebView environments
 */

/**
 * Check if running in Electron environment
 */
export function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.electronApi?.isElectron;
}

/**
 * Check if running in PyWebView environment
 */
export function isPyWebView(): boolean {
  return typeof window !== "undefined" && !!window.pywebview;
}

/**
 * Check if running in any desktop environment
 */
export function isDesktop(): boolean {
  return isElectron() || isPyWebView();
}

/**
 * Open a native folder picker dialog
 * Falls back to a prompt in browser environment
 */
export async function selectFolder(): Promise<string | null> {
  if (isElectron() && window.electronApi) {
    return await window.electronApi.selectFolder();
  }
  if (isPyWebView() && window.pywebview) {
    return await window.pywebview.api.select_folder();
  }
  // Browser fallback
  return prompt("Enter folder path:");
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
  if (isPyWebView() && window.pywebview) {
    return await window.pywebview.api.select_file(fileTypes, allowMultiple);
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
  if (isPyWebView() && window.pywebview) {
    return await window.pywebview.api.save_file(defaultFilename, fileTypes);
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
  if (isPyWebView() && window.pywebview) {
    return await window.pywebview.api.reveal_in_explorer(filePath);
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
  if (isPyWebView() && window.pywebview) {
    return await window.pywebview.api.open_external(url);
  }
  // Browser fallback
  window.open(url, "_blank");
}
