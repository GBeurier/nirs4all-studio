/**
 * File dialog utilities for native desktop integration
 */

/**
 * Check if running in PyWebView environment
 */
export function isPyWebView(): boolean {
  return typeof window !== "undefined" && !!window.pywebview;
}

/**
 * Open a native folder picker dialog
 * Falls back to a prompt in browser environment
 */
export async function selectFolder(): Promise<string | null> {
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
  if (isPyWebView() && window.pywebview) {
    return await window.pywebview.api.save_file(defaultFilename, fileTypes);
  }
  // Browser fallback
  return prompt("Enter save path:", defaultFilename);
}
