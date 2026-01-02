/**
 * PyWebView global type declarations
 * These types enable TypeScript support for the native desktop integration
 */

interface PyWebViewApi {
  /**
   * Open a native folder picker dialog
   * @returns The selected folder path or null if cancelled
   */
  select_folder(): Promise<string | null>;

  /**
   * Open a native file picker dialog
   * @param fileTypes - Optional array of file extensions to filter (e.g., ['.csv', '.xlsx'])
   * @param allowMultiple - Whether to allow selecting multiple files
   * @returns The selected file path(s) or null if cancelled
   */
  select_file(
    fileTypes?: string[],
    allowMultiple?: boolean
  ): Promise<string | string[] | null>;

  /**
   * Open a native save file dialog
   * @param defaultFilename - Default filename suggestion
   * @param fileTypes - Optional array of file extensions to filter
   * @returns The selected save path or null if cancelled
   */
  save_file(
    defaultFilename?: string,
    fileTypes?: string[]
  ): Promise<string | null>;

  /**
   * Get the current working directory
   */
  get_cwd(): Promise<string>;

  /**
   * Check if a path exists
   */
  path_exists(path: string): Promise<boolean>;

  /**
   * List directory contents
   */
  list_dir(path: string): Promise<string[]>;

  /**
   * Open a file or folder in the system file explorer
   */
  reveal_in_explorer(path: string): Promise<void>;

  /**
   * Open a URL in the system default browser
   */
  open_external(url: string): Promise<void>;
}

interface PyWebView {
  api: PyWebViewApi;
}

declare global {
  interface Window {
    /**
     * PyWebView object available when running in desktop mode
     * Will be undefined when running in browser/development mode
     */
    pywebview?: PyWebView;
  }
}

export {};
