/// <reference types="vite/client" />

interface Window {
  pywebview?: {
    api: {
      select_folder: () => Promise<string | null>;
      select_file: (
        fileTypes?: string[],
        allowMultiple?: boolean
      ) => Promise<string | string[] | null>;
      save_file: (
        defaultFilename?: string,
        fileTypes?: string[]
      ) => Promise<string | null>;
    };
  };
}
